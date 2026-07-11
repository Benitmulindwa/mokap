<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['project_id', 'path', 'mime', 'size_bytes', 'meta_json'])]
class Upload extends Model
{
    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'meta_json' => 'array',
        ];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }
}
