<?php

namespace Tests\Feature;

use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProjectUploadApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_create_project(): void
    {
        $response = $this->postJson('/api/projects');

        $response->assertCreated()
            ->assertJsonStructure(['project_id']);

        $projectId = $response->json('project_id');

        $this->assertDatabaseHas('projects', [
            'id' => $projectId,
            'status' => 'created',
        ]);
    }

    public function test_can_upload_video_to_project_and_mark_uploaded(): void
    {
        Storage::fake('local');
        $project = Project::create([
            'status' => 'created',
        ]);

        $video = UploadedFile::fake()->createWithContent(
            'clip.webm',
            'fake-video-content',
        );

        $response = $this->post('/api/projects/'.$project->id.'/upload', [
            'video' => $video,
        ]);

        $response->assertCreated()
            ->assertJson([
                'project_id' => $project->id,
                'status' => 'uploaded',
            ]);

        $project->refresh();

        $this->assertSame('uploaded', $project->status);
        $this->assertDatabaseHas('uploads', [
            'project_id' => $project->id,
            'mime' => 'video/webm',
            'size_bytes' => strlen('fake-video-content'),
        ]);

        $uploadPath = $project->uploads()->firstOrFail()->path;
        Storage::disk('local')->assertExists($uploadPath);
    }
}
