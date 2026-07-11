<?php

namespace App\Http\Controllers;

use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function store(): JsonResponse
    {
        $project = Project::create([
            'status' => 'created',
        ]);

        return response()->json([
            'project_id' => $project->id,
        ], 201);
    }

    public function upload(Request $request, Project $project): JsonResponse
    {
        $validated = $request->validate([
            'video' => ['required', 'file', 'max:102400', 'mimes:webm,mp4,mov', 'mimetypes:video/webm,video/mp4,video/quicktime'],
        ]);

        $file = $validated['video'];
        $path = $file->store('projects/'.$project->id, 'local');

        $project->uploads()->create([
            'path' => $path,
            'mime' => $file->getMimeType() ?? $file->getClientMimeType(),
            'size_bytes' => $file->getSize(),
            'meta_json' => [
                'original_name' => $file->getClientOriginalName(),
            ],
        ]);

        $project->update([
            'status' => 'uploaded',
        ]);

        return response()->json([
            'project_id' => $project->id,
            'status' => $project->status,
        ], 201);
    }
}
