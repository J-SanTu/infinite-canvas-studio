-- Reference schema for the single local workspace.
-- Runtime storage currently uses app-db.json plus dedicated SQLite ledgers.

CREATE TABLE local_settings (
    capability TEXT PRIMARY KEY CHECK (capability IN ('image', 'text', 'video', 'audio', 'music')),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_format TEXT NOT NULL DEFAULT 'openai',
    encrypted_api_key TEXT NOT NULL,
    api_key_hash TEXT NOT NULL,
    models_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);

CREATE TABLE canvas_projects (
    id TEXT PRIMARY KEY,
    local_project_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    canvas_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE storage_objects (
    id TEXT PRIMARY KEY,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    local_asset_id TEXT NOT NULL UNIQUE,
    storage_key TEXT,
    folder_id TEXT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    asset_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE prompt_library_items (
    id TEXT PRIMARY KEY,
    folder_id TEXT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    image_storage_key TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE generation_runs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    capability TEXT NOT NULL,
    operation TEXT NOT NULL,
    model_id TEXT,
    status TEXT NOT NULL,
    project_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
