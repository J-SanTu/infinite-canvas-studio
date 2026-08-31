import { DatabaseSync } from "node:sqlite";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const imageUsageDbPath = process.env.CANVAS_IMAGE_USAGE_DB_PATH ? resolve(process.env.CANVAS_IMAGE_USAGE_DB_PATH) : resolve(serverDir, "data/image-usage.sqlite");
export const imageUsageOutboxPath = process.env.CANVAS_IMAGE_USAGE_OUTBOX_PATH ? resolve(process.env.CANVAS_IMAGE_USAGE_OUTBOX_PATH) : resolve(serverDir, "data/image-usage-outbox.ndjson");

let database;
let initialized = false;
let outboxQueue = Promise.resolve();

export function initializeImageUsageRepository(legacyEvents = []) {
    if (initialized) return;
    mkdirSync(dirname(imageUsageDbPath), { recursive: true });
    database = new DatabaseSync(imageUsageDbPath);
    if ((statSync(imageUsageDbPath).mode & 0o777) !== 0o600) chmodSync(imageUsageDbPath, 0o600);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    database.exec(`
        CREATE TABLE IF NOT EXISTS image_usage_events (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            user_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT '',
            total_tokens INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            reported INTEGER NOT NULL DEFAULT 0,
            image_count INTEGER NOT NULL DEFAULT 0,
            quality_tier TEXT,
            legacy_uncounted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_image_usage_events_user_created ON image_usage_events(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_image_usage_events_created ON image_usage_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_image_usage_events_model ON image_usage_events(model);
    `);
    migrateLegacyEvents(legacyEvents);
    initialized = true;
}

export function insertImageUsageEvent(event) {
    const db = requireDatabase();
    const statement = db.prepare(`
        INSERT OR IGNORE INTO image_usage_events (
            id, request_id, user_id, operation, model,
            total_tokens, input_tokens, output_tokens, reported,
            image_count, quality_tier, legacy_uncounted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const normalized = normalizeEvent(event);
    const result = statement.run(
        normalized.id,
        normalized.requestId,
        normalized.userId,
        normalized.operation,
        normalized.model,
        normalized.totalTokens,
        normalized.inputTokens,
        normalized.outputTokens,
        normalized.reported ? 1 : 0,
        normalized.imageCount,
        normalized.qualityTier,
        normalized.legacyUncounted ? 1 : 0,
        normalized.createdAt,
    );
    return Number(result.changes) > 0;
}

export function summarizeImageUsage({ userId, from, to } = {}) {
    const { where, values } = buildWhere({ userId, from, to });
    const row = requireDatabase()
        .prepare(`
            SELECT
                COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COUNT(*) AS request_count,
                COALESCE(SUM(CASE WHEN reported = 0 THEN 1 ELSE 0 END), 0) AS unreported_request_count,
                COALESCE(SUM(image_count), 0) AS image_count,
                COALESCE(SUM(CASE WHEN quality_tier = '1K' THEN image_count ELSE 0 END), 0) AS image_count_1k,
                COALESCE(SUM(CASE WHEN quality_tier = '2K' THEN image_count ELSE 0 END), 0) AS image_count_2k,
                COALESCE(SUM(CASE WHEN quality_tier = '4K' THEN image_count ELSE 0 END), 0) AS image_count_4k,
                COALESCE(SUM(CASE WHEN quality_tier IS NULL AND legacy_uncounted = 0 THEN image_count ELSE 0 END), 0) AS unclassified_image_count,
                COALESCE(SUM(CASE WHEN legacy_uncounted = 1 THEN 1 ELSE 0 END), 0) AS legacy_uncounted_request_count,
                COALESCE(SUM(CASE WHEN legacy_uncounted = 1 THEN total_tokens ELSE 0 END), 0) AS legacy_uncounted_tokens
            FROM image_usage_events${where}
        `)
        .get(...values);
    return publicSummary(row);
}

export function listImageUsageEvents({ userId, from, to, limit = 500, offset = 0 } = {}) {
    const { where, values } = buildWhere({ userId, from, to });
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 500)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    return requireDatabase()
        .prepare(`
            SELECT id, request_id, user_id, operation, model, total_tokens, input_tokens,
                   output_tokens, reported, image_count, quality_tier, legacy_uncounted, created_at
            FROM image_usage_events${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
        `)
        .all(...values, safeLimit, safeOffset)
        .map(publicEvent);
}

export function countImageUsageEvents({ userId, from, to } = {}) {
    const { where, values } = buildWhere({ userId, from, to });
    const row = requireDatabase().prepare(`SELECT COUNT(*) AS count FROM image_usage_events${where}`).get(...values);
    return numberValue(row?.count);
}

export async function appendImageUsageOutbox(event) {
    await mkdir(dirname(imageUsageOutboxPath), { recursive: true });
    await appendFile(imageUsageOutboxPath, `${JSON.stringify(normalizeEvent(event))}\n`, { encoding: "utf8", mode: 0o600 });
}

export function flushImageUsageOutbox() {
    const run = outboxQueue.then(async () => {
        if (!existsSync(imageUsageOutboxPath)) return { recovered: 0, remaining: 0 };
        const raw = await readFile(imageUsageOutboxPath, "utf8").catch((error) => {
            if (error?.code === "ENOENT") return "";
            throw error;
        });
        const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return { recovered: 0, remaining: 0 };
        let recovered = 0;
        const remaining = [];
        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                insertImageUsageEvent(event);
                recovered += 1;
            } catch {
                remaining.push(line);
            }
        }
        const tempPath = `${imageUsageOutboxPath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tempPath, remaining.length ? `${remaining.join("\n")}\n` : "", { encoding: "utf8", mode: 0o600 });
        await rename(tempPath, imageUsageOutboxPath);
        return { recovered, remaining: remaining.length };
    });
    outboxQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

function migrateLegacyEvents(events) {
    if (!Array.isArray(events) || !events.length) return;
    const db = requireDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const source of events) {
            const hasImageCount = source.imageCount !== undefined && source.imageCount !== null;
            insertImageUsageEvent({
                ...source,
                requestId: source.requestId || `legacy:${source.id}`,
                legacyUncounted: source.legacyUncounted ?? !hasImageCount,
            });
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

function buildWhere({ userId, from, to }) {
    const clauses = [];
    const values = [];
    if (userId) {
        clauses.push("user_id = ?");
        values.push(String(userId));
    }
    if (from) {
        clauses.push("created_at >= ?");
        values.push(normalizeDate(from));
    }
    if (to) {
        clauses.push("created_at < ?");
        values.push(normalizeDate(to));
    }
    return { where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
}

function normalizeEvent(source) {
    return {
        id: String(source.id || source.requestId || ""),
        requestId: String(source.requestId || source.id || ""),
        userId: String(source.userId || ""),
        operation: source.operation === "edit" ? "edit" : "generation",
        model: String(source.model || ""),
        totalTokens: nonNegativeInteger(source.totalTokens),
        inputTokens: nonNegativeInteger(source.inputTokens),
        outputTokens: nonNegativeInteger(source.outputTokens),
        reported: source.reported === true,
        imageCount: nonNegativeInteger(source.imageCount),
        qualityTier: ["1K", "2K", "4K"].includes(source.qualityTier) ? source.qualityTier : null,
        legacyUncounted: source.legacyUncounted === true,
        createdAt: normalizeDate(source.createdAt || new Date()),
    };
}

function publicSummary(row) {
    return {
        totalTokens: numberValue(row?.total_tokens),
        inputTokens: numberValue(row?.input_tokens),
        outputTokens: numberValue(row?.output_tokens),
        requestCount: numberValue(row?.request_count),
        unreportedRequestCount: numberValue(row?.unreported_request_count),
        imageCount: numberValue(row?.image_count),
        imageCount1K: numberValue(row?.image_count_1k),
        imageCount2K: numberValue(row?.image_count_2k),
        imageCount4K: numberValue(row?.image_count_4k),
        unclassifiedImageCount: numberValue(row?.unclassified_image_count),
        legacyUncountedRequestCount: numberValue(row?.legacy_uncounted_request_count),
        legacyUncountedTokens: numberValue(row?.legacy_uncounted_tokens),
    };
}

function publicEvent(row) {
    return {
        id: row.id,
        requestId: row.request_id,
        userId: row.user_id,
        operation: row.operation,
        model: row.model || "",
        totalTokens: numberValue(row.total_tokens),
        inputTokens: numberValue(row.input_tokens),
        outputTokens: numberValue(row.output_tokens),
        reported: Boolean(row.reported),
        imageCount: numberValue(row.image_count),
        qualityTier: row.quality_tier || null,
        legacyUncounted: Boolean(row.legacy_uncounted),
        createdAt: row.created_at,
    };
}

function normalizeDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("无效的用量日期范围");
    return date.toISOString();
}

function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function requireDatabase() {
    if (!database) throw new Error("图片用量数据库尚未初始化");
    return database;
}
