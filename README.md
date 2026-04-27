# Mokap

A mobile-first camera web app that records a single video and automatically generates **both** a horizontal **16:9** and a vertical **9:16** output from the same recording.

## Features

- 📸 **Live camera preview** with dual crop-guide overlay — see exactly what each output will look like before recording
- 🔴 **One-tap recording** — press once to start, press again to stop
- ⚙️ **Automatic post-processing** — the recorded footage is re-rendered through offscreen canvases to produce two centre-cropped clips
- ⬇️ **Download both clips** as separate WebM (or MP4 on compatible browsers) files
- 📱 **Mobile-first** — safe-area aware layout, dark UI, no install required

## How it works

```
Camera ──► MediaRecorder ──► raw Blob
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
        Canvas 1280×720                   Canvas 720×1280
        (centre-crop → 16:9)             (centre-crop → 9:16)
               │                                 │
        MediaRecorder                     MediaRecorder
               │                                 │
        WebM/MP4 Blob                     WebM/MP4 Blob
               │                                 │
          Download 16:9                    Download 9:16
```

Each frame from the raw recording is drawn onto both canvases using a **cover crop** (the largest centred rectangle that fills the target aspect ratio without stretching). Both canvas streams are re-encoded in parallel, so processing time equals the duration of the recording.

## Usage

No build step is needed — open `index.html` directly in a modern browser (Chrome, Edge, Firefox, Android Chrome) or serve it from any static file server:

```bash
# e.g. with Python
python3 -m http.server 8080
# then open http://localhost:8080
```

1. Grant camera and microphone permissions.
2. Toggle **16:9** or **9:16** to preview the crop guides.
3. Tap the **record button** to start. Tap again to stop.
4. Wait for processing (equals recording length).
5. Preview and download both outputs.

## Browser compatibility

| Browser | Record | Re-encode outputs |
|---------|--------|-------------------|
| Chrome / Edge (desktop & Android) | ✅ | ✅ |
| Firefox | ✅ | ✅ |
| Safari 17+ (macOS/iOS) | ✅ | ⚠️ Falls back to original |
| Safari < 17 (iOS) | ✅ | ⚠️ Falls back to original |

On browsers where `HTMLCanvasElement.captureStream` is unavailable (older Safari / iOS), the app gracefully falls back to offering the original recording for download in both slots.
