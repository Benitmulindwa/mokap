/**
 * Mokap — mobile camera app
 *
 * Records a single video and generates both:
 *   • Horizontal 16:9 output
 *   • Vertical   9:16 output
 *
 * Processing pipeline:
 *   Camera → MediaRecorder (raw blob) → Canvas re-render × 2 → download blobs
 */

'use strict';

/* ── Helpers ──────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/** Return the first supported MediaRecorder MIME type, or '' for browser default. */
function preferredMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
    'video/mp4',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

/**
 * Draw a video frame onto a canvas context using "cover" cropping.
 * The frame is centre-cropped to exactly fill targetW × targetH.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement} video  - source frame
 * @param {number} targetW
 * @param {number} targetH
 */
function drawCoveredFrame(ctx, video, targetW, targetH) {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return;

  const srcRatio    = srcW / srcH;
  const targetRatio = targetW / targetH;

  let sx, sy, sw, sh;

  if (srcRatio > targetRatio) {
    // Source wider than target → letterbox the sides
    sh = srcH;
    sw = srcH * targetRatio;
    sx = (srcW - sw) / 2;
    sy = 0;
  } else {
    // Source taller than target → crop top & bottom
    sw = srcW;
    sh = srcW / targetRatio;
    sx = 0;
    sy = (srcH - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetW, targetH);
}

/* ── Camera App ───────────────────────────────────────────────── */
const MokapApp = (() => {
  /* ---- DOM ---------------------------------------------------- */
  const views = {
    camera:     $('camera-view'),
    processing: $('processing-view'),
    results:    $('results-view'),
  };

  const cameraPreview   = $('camera-preview');
  const cropGuideCanvas = $('crop-guide');
  const recBadge        = $('rec-badge');
  const recTimer        = $('rec-timer');
  const recordBtn       = $('record-btn');
  const processingMsg   = $('processing-msg');
  const backBtn         = $('back-btn');
  const video16x9El     = $('video-16x9');
  const video9x16El     = $('video-9x16');
  const dl16x9El        = $('dl-16x9');
  const dl9x16El        = $('dl-9x16');
  const ratioButtons    = document.querySelectorAll('.ratio-btn');
  const recordHint      = document.querySelector('.record-hint');
  const cameraErrorEl   = $('camera-error');
  const cameraErrorMsg  = $('camera-error-msg');
  const cameraRetryBtn  = $('camera-retry-btn');

  /* ---- State -------------------------------------------------- */
  let cameraStream   = null;
  let mediaRecorder  = null;
  let recordedChunks = [];
  let isRecording    = false;
  let timerInterval  = null;
  let recordStart    = 0;
  let previewRatio   = '16:9';   // which guide is highlighted
  let blobUrls       = [];       // track object URLs so we can revoke them

  /* ---- View helpers ------------------------------------------ */
  function showView(name) {
    for (const [key, el] of Object.entries(views)) {
      el.classList.toggle('active', key === name);
    }
  }

  /* ---- Camera setup ------------------------------------------ */
  async function initCamera() {
    cameraErrorEl.hidden = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('Camera API not available in this browser.'), { name: 'NotSupportedError' });
      }
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: true,
        });
      } catch (_) {
        // Fallback: any camera, front-facing acceptable
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      }

      cameraPreview.srcObject = cameraStream;
      await cameraPreview.play();
      initCropGuideObserver();
    } catch (err) {
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      cameraErrorMsg.textContent = isDenied
        ? 'Camera access was denied. Please grant permission and try again.'
        : 'Could not access the camera: ' + err.message;
      cameraErrorEl.hidden = false;
      // Disable record button so user can't attempt to record without a stream
      recordBtn.disabled = true;
    }
  }

  /* ---- Crop-guide overlay ------------------------------------ */
  let guideRafId     = null;
  let guideResizeObs = null;

  /**
   * Return { x, y, w, h } of the crop region in the overlay coordinate space.
   * Uses the same "cover" logic the canvas processing will use.
   */
  function cropRegion(containerW, containerH, targetRatio) {
    const containerRatio = containerW / containerH;
    let w, h, x, y;
    if (containerRatio > targetRatio) {
      h = containerH;
      w = h * targetRatio;
      x = (containerW - w) / 2;
      y = 0;
    } else {
      w = containerW;
      h = w / targetRatio;
      x = 0;
      y = (containerH - h) / 2;
    }
    return { x, y, w, h };
  }

  function paintCropGuide() {
    const canvas = cropGuideCanvas;
    const wrapper = canvas.parentElement;
    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;

    if (canvas.width !== W || canvas.height !== H) {
      canvas.width  = W;
      canvas.height = H;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const activeRatio   = previewRatio === '16:9' ? 16 / 9 : 9 / 16;
    const inactiveRatio = previewRatio === '16:9' ? 9 / 16 : 16 / 9;

    const active   = cropRegion(W, H, activeRatio);
    const inactive = cropRegion(W, H, inactiveRatio);

    /* Dim area outside the active crop */
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    // top
    ctx.fillRect(0, 0, W, active.y);
    // bottom
    ctx.fillRect(0, active.y + active.h, W, H - active.y - active.h);
    // left
    ctx.fillRect(0, active.y, active.x, active.h);
    // right
    ctx.fillRect(active.x + active.w, active.y, W - active.x - active.w, active.h);

    /* Active crop border (solid) */
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(active.x + 0.75, active.y + 0.75, active.w - 1.5, active.h - 1.5);

    /* Inactive crop border (dashed) */
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(inactive.x + 0.5, inactive.y + 0.5, inactive.w - 1, inactive.h - 1);

    /* Corner labels */
    ctx.setLineDash([]);
    ctx.font      = 'bold 11px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(previewRatio, active.x + 8, active.y + 16);

    const inactiveLabel = previewRatio === '16:9' ? '9:16' : '16:9';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(inactiveLabel, inactive.x + 8, inactive.y + 16);
  }

  function scheduleCropGuideUpdate() {
    cancelAnimationFrame(guideRafId);
    guideRafId = requestAnimationFrame(() => {
      paintCropGuide();
    });
  }

  /** Attach a ResizeObserver so the guide repaints on orientation changes. */
  function initCropGuideObserver() {
    if (guideResizeObs) return; // already set up
    guideResizeObs = new ResizeObserver(() => scheduleCropGuideUpdate());
    guideResizeObs.observe(cropGuideCanvas.parentElement);
    // Paint once immediately (covers the case where the camera is unavailable)
    scheduleCropGuideUpdate();
  }

  /* ---- Recording -------------------------------------------- */
  function startRecording() {
    recordedChunks = [];

    const mimeType = preferredMimeType();
    try {
      mediaRecorder = new MediaRecorder(
        cameraStream,
        mimeType ? { mimeType } : {},
      );
    } catch (_) {
      mediaRecorder = new MediaRecorder(cameraStream);
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = onRecordingStop;

    mediaRecorder.start(200); // 200 ms chunks for smooth progress

    isRecording = true;
    recordBtn.classList.add('recording');
    recordBtn.setAttribute('aria-label', 'Stop recording');
    recBadge.hidden = false;
    recordHint.textContent = 'Tap to stop';

    recordStart = Date.now();
    recTimer.classList.add('visible');
    timerInterval = setInterval(tickTimer, 500);
    tickTimer();
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    clearInterval(timerInterval);
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.setAttribute('aria-label', 'Start recording');
    recBadge.hidden = true;
    recTimer.classList.remove('visible');
    recordHint.textContent = 'Tap to record';

    showView('processing');
    mediaRecorder.stop();
  }

  function tickTimer() {
    const sec  = Math.floor((Date.now() - recordStart) / 1000);
    const mm   = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss   = String(sec % 60).padStart(2, '0');
    recTimer.textContent = `${mm}:${ss}`;
  }

  /* ---- Post-processing --------------------------------------- */
  async function uploadRawRecording(rawBlob) {
    const projectResponse = await fetch('/api/projects', {
      method: 'POST',
    });

    if (!projectResponse.ok) {
      throw new Error(`Project creation failed (${projectResponse.status})`);
    }

    const { project_id: projectId } = await projectResponse.json();
    if (!projectId) {
      throw new Error('Project creation did not return project_id');
    }

    const ext = rawBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const file = new File([rawBlob], `recording.${ext}`, {
      type: rawBlob.type || 'video/webm',
    });

    const formData = new FormData();
    formData.append('video', file);

    const uploadResponse = await fetch(`/api/projects/${projectId}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed (${uploadResponse.status})`);
    }
  }

  async function onRecordingStop() {
    const mimeType = recordedChunks[0]?.type || 'video/webm';
    const rawBlob  = new Blob(recordedChunks, { type: mimeType });

    try {
      await uploadRawRecording(rawBlob);
    } catch (err) {
      console.error('[Mokap] raw upload error:', err);
    }

    try {
      processingMsg.textContent = 'Analyzing source…';
      const { blob16x9, blob9x16 } = await generateOutputs(rawBlob);
      displayResults(blob16x9, blob9x16);
    } catch (err) {
      console.error('[Mokap] processing error:', err);
      // Graceful fallback: show the raw recording for both slots
      processingMsg.textContent = 'Re-encoding not supported; showing original.';
      displayResults(rawBlob, rawBlob);
    }
  }

  /**
   * Core processing: play the raw blob through an offscreen <video>,
   * draw each frame onto two canvases (one 16:9, one 9:16),
   * and capture them as separate recordings.
   *
   * Returns { blob16x9, blob9x16 }.
   */
  async function generateOutputs(rawBlob) {
    /* ---- Source video ---------------------------------------- */
    const srcUrl = URL.createObjectURL(rawBlob);

    const src = document.createElement('video');
    src.src         = srcUrl;
    src.muted       = false;
    src.volume      = 0;
    src.playsInline = true;

    await waitForEvent(src, 'loadedmetadata', 10_000);

    const srcW = src.videoWidth;
    const srcH = src.videoHeight;

    processingMsg.textContent = `Source ${srcW}×${srcH} — building outputs…`;

    /* ---- Output canvases ------------------------------------- */
    // Fixed output sizes – generous enough for good quality on mobile
    const OUT_16x9 = { w: 1280, h: 720 };
    const OUT_9x16 = { w: 720,  h: 1280 };

    const canvas16x9 = makeCanvas(OUT_16x9.w, OUT_16x9.h);
    const canvas9x16 = makeCanvas(OUT_9x16.w, OUT_9x16.h);

    const ctx16x9 = canvas16x9.getContext('2d');
    const ctx9x16 = canvas9x16.getContext('2d');

    /* ---- Check captureStream support ------------------------- */
    if (typeof canvas16x9.captureStream !== 'function') {
      // iOS Safari < 17 does not support captureStream on canvas
      URL.revokeObjectURL(srcUrl);
      throw new Error('captureStream not supported');
    }

    /* ---- Audio routing (video element → AudioContext → dest) - */
    const audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    const srcNode   = audioCtx.createMediaElementSource(src);
    const audioDest = audioCtx.createMediaStreamDestination();
    srcNode.connect(audioDest);
    // Note: we intentionally do NOT connect to audioCtx.destination
    //       so the re-processed audio is silent during the background render.

    const audioTrack = audioDest.stream.getAudioTracks()[0];

    /* ---- Canvas streams + MediaRecorders --------------------- */
    const mimeType = preferredMimeType();
    const recOpts  = mimeType ? { mimeType } : {};

    function makeRecorder(canvas) {
      const videoTracks = canvas.captureStream(30).getVideoTracks();
      const tracks = audioTrack ? [...videoTracks, audioTrack.clone()] : videoTracks;
      const stream = new MediaStream(tracks);
      let rec;
      try {
        rec = new MediaRecorder(stream, recOpts);
      } catch (_) {
        rec = new MediaRecorder(stream);
      }
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      return { rec, chunks };
    }

    const { rec: rec16x9, chunks: chunks16x9 } = makeRecorder(canvas16x9);
    const { rec: rec9x16, chunks: chunks9x16  } = makeRecorder(canvas9x16);

    rec16x9.start();
    rec9x16.start();

    /* ---- Animation loop (frame-by-frame rendering) ----------- */
    let rafId;

    const renderLoop = () => {
      if (src.paused || src.ended) return;
      drawCoveredFrame(ctx16x9, src, OUT_16x9.w, OUT_16x9.h);
      drawCoveredFrame(ctx9x16, src, OUT_9x16.w, OUT_9x16.h);
      rafId = requestAnimationFrame(renderLoop);
    };

    /* ---- Play and wait --------------------------------------- */
    const [blob16x9, blob9x16] = await new Promise((resolve, reject) => {
      let done16x9 = false;
      let done9x16 = false;
      let result16x9, result9x16;

      const tryResolve = () => {
        if (done16x9 && done9x16) {
          URL.revokeObjectURL(srcUrl);
          audioCtx.close();
          resolve([result16x9, result9x16]);
        }
      };

      rec16x9.onstop = () => {
        result16x9 = new Blob(chunks16x9, { type: chunks16x9[0]?.type || 'video/webm' });
        done16x9 = true;
        tryResolve();
      };
      rec9x16.onstop = () => {
        result9x16 = new Blob(chunks9x16, { type: chunks9x16[0]?.type || 'video/webm' });
        done9x16 = true;
        tryResolve();
      };

      src.onended = () => {
        cancelAnimationFrame(rafId);
        rec16x9.stop();
        rec9x16.stop();
      };
      src.onerror = (e) => reject(e);

      processingMsg.textContent = 'Rendering frames…';
      src.play().then(() => {
        renderLoop();
      }).catch(reject);
    });

    return { blob16x9, blob9x16 };
  }

  /* ---- Results display -------------------------------------- */
  function displayResults(blob16x9, blob9x16) {
    // Revoke any previously allocated URLs
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
    blobUrls = [];

    const url16x9 = URL.createObjectURL(blob16x9);
    const url9x16 = URL.createObjectURL(blob9x16);
    blobUrls.push(url16x9, url9x16);

    video16x9El.src = url16x9;
    video9x16El.src = url9x16;
    dl16x9El.href   = url16x9;
    dl9x16El.href   = url9x16;

    const ext16 = blob16x9.type.includes('mp4') ? 'mp4' : 'webm';
    const ext9  = blob9x16.type.includes('mp4') ? 'mp4' : 'webm';
    dl16x9El.download = `mokap-16x9.${ext16}`;
    dl9x16El.download = `mokap-9x16.${ext9}`;

    showView('results');
  }

  /* ---- Event listeners -------------------------------------- */
  function setupListeners() {
    /* Camera error retry */
    cameraRetryBtn.addEventListener('click', () => {
      recordBtn.disabled = false;
      initCamera();
    });

    /* Record / stop */
    recordBtn.addEventListener('click', () => {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });

    /* Back → camera */
    backBtn.addEventListener('click', () => {
      video16x9El.pause();
      video9x16El.pause();
      video16x9El.src = '';
      video9x16El.src = '';

      // Free memory from previous session's output blobs
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
      blobUrls = [];

      showView('camera');

      if (!cameraStream || !cameraStream.active) {
        initCamera();
      }
    });

    /* Aspect-ratio toggle */
    ratioButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        ratioButtons.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        previewRatio = btn.dataset.ratio;
        scheduleCropGuideUpdate();
      });
    });
  }

  /* ---- Bootstrap -------------------------------------------- */
  async function init() {
    setupListeners();
    showView('camera');
    // Paint crop guides immediately (camera may take a moment to start)
    initCropGuideObserver();
    await initCamera();
  }

  init();

  /* ---- Private utilities ------------------------------------ */
  function makeCanvas(w, h) {
    const c  = document.createElement('canvas');
    c.width  = w;
    c.height = h;
    return c;
  }

  /**
   * Return a Promise that resolves on the first occurrence of `eventName`
   * on `target`, or rejects after `timeoutMs`.
   */
  function waitForEvent(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
      target.addEventListener(eventName, () => {
        clearTimeout(tid);
        resolve();
      }, { once: true });
      target.addEventListener('error', (e) => {
        clearTimeout(tid);
        reject(e);
      }, { once: true });
    });
  }
})();
