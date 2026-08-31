import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const assetChangeDbPath = process.env.CANVAS_ASSET_CHANGE_DB_PATH ? resolve(process.env.CANVAS_ASSET_CHANGE_DB_PATH) : resolve(serverDir, "data/asset-changes.sqlite");

let database;
let initialized = false;

export function initializeAssetChangeRepository(legacyChanges = []) {
    if (initialized) return;
    mkdirSync(dirname(assetChangeDbPath), { recursive: true });
    database = new DatabaseSync(assetChangeDbPath);
    if ((statSync(assetChangeDbPath).mode & 0o777) !== 0o600) chmodSync(assetChangeDbPath, 0o600);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    database.exec(`
        CREATE TABLE IF NOT EXISTS asset_library_changes (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            source TEXT NOT NULL DEFAULT 'mutation',
            operations TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            UNIQUE(user_id, revision)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_library_changes_user_revision ON asset_library_changes(user_id, revision);
    `);
    migrateLegacyChanges(legacyChanges);
    initialized = true;
}

export function appendAssetChangeRecord(change) {
    const db = requireDatabase();
    const normalized = normalizeChange(change);
    db.prepare(`
        INSERT OR IGNORE INTO asset_library_changes (id, user_id, revision, source, operations, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(normalized.id, normalized.userId, normalized.revision, normalized.source, normalized.operations, normalized.createdAt);
}

export function listAssetChangeRecords(userId, afterRevision = 0, limit = 100) {
    const safeAfter = Math.max(0, Math.floor(Number(afterRevision) || 0));
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return requireDatabase()
        .prepare(`
            SELECT id, revision, source, operations, created_at
            FROM asset_library_changes
            WHERE user_id = ? AND revision > ?
            ORDER BY revision ASC
            LIMIT ?
        `)
        .all(String(userId), safeAfter, safeLimit)
        .map((row) => ({ id: row.id, revision: Number(row.revision), source: row.source, operations: parseOperations(row.operations), createdAt: row.created_at }));
}

export function deleteAssetChangeRecords(userId) {
    requireDatabase().prepare("DELETE FROM asset_library_changes WHERE user_id = ?").run(String(userId));
}

function migrateLegacyChanges(changes) {
    if (!Array.isArray(changes) || !changes.length) return;
    const db = requireDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const change of changes) appendAssetChangeRecord(change);
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

function normalizeChange(source) {
    return {
        id: String(source.id || `asset_change_${source.userId}_${source.revision}`),
        userId: String(source.userId || ""),
        revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
        source: source.source === "snapshot" ? "snapshot" : "mutation",
        operations: typeof source.operations === "string" ? source.operations : JSON.stringify(Array.isArray(source.operations) ? source.operations : []),
        createdAt: normalizeDate(source.createdAt),
    };
}

function parseOperations(value) {
    try {
        const operations = JSON.parse(String(value || "[]"));
        return Array.isArray(operations) ? operations : [];
    } catch {
        return [];
    }
}

function normalizeDate(value) {
    const date = new Date(value || Date.now());
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function requireDatabase() {
    if (!database) throw new Error("素材变更 SQLite repository 尚未初始化");
    return database;
}
