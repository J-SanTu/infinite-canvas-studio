import { appendFileSync, mkdirSync, readdirSync, statSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";

const secrets = new Set();
const REDACTED = "[REDACTED]";
const sensitive = /authorization|cookie|password|passwd|secret|token|api.?key|credential|prompt|inputSnapshot|requestBody|responseBody|b64|base64|imageData|^body$|^content$|^input$|^value$/i;
export function registerLogSecret(value) {
    if (typeof value === "string" && value.length >= 6) secrets.add(value);
}

export function safeText(value) {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join(REDACTED);
    text = text.replace(/\bsk-[\w-]+/gi, REDACTED)
        .replace(/\bBearer\s+[^\s,;"']+/gi, `Bearer ${REDACTED}`)
        .replace(/((?:api[_-]?key|password|secret|token|cookie|authorization)\s*[=:]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
        .replace(/data:[^\s"']+/gi, "[DATA OMITTED]")
        .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
            try { const url = new URL(raw); return `${url.protocol}//${url.host}${url.pathname}`; } catch { return "[URL OMITTED]"; }
        });
    text = text.split(homedir()).join("~");
    return text.slice(0, 4000);
}

export function sanitizeLog(value, depth = 0, seen = new WeakSet()) {
    if (depth > 7) return "[DEPTH LIMIT]";
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return safeText(value);
    if (typeof value !== "object") return safeText(value);
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (value instanceof Error) {
        return sanitizeLog({ name: value.name, message: value.message, code: value.code, stack: value.stack,
            cause: value.cause, errors: value.errors, syscall: value.syscall, hostname: value.hostname }, depth + 1, seen);
    }
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return "[BINARY OMITTED]";
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeLog(item, depth + 1, seen));
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [safeText(key), sensitive.test(key) ? REDACTED : sanitizeLog(item, depth + 1, seen)]));
}

// No console dependency: logging failures must not recurse or stop application work.
export function createDiagnosticLogger({ directory, maxFileBytes = 5 * 1024 * 1024, maxTotalBytes = 200 * 1024 * 1024, retentionDays = 30, now = () => new Date() }) {
    let current = "", size = 0, lastCleanup = 0, lastError = null, lastWriteAt = null;
    const sessionId = randomUUID();
    const list = () => readdirSync(directory).filter((name) => /^diagnostic-\d{4}-\d{2}-\d{2}-[\w-]+\.jsonl$/.test(name))
        .map((name) => { const stat = statSync(join(directory, name)); return { name, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), time: stat.mtimeMs }; })
        .sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
    const cleanup = (date) => {
        const files = list();
        let total = files.reduce((sum, file) => sum + file.bytes, 0);
        for (const file of files) {
            if (file.name === current) continue;
            if (date.getTime() - file.time > retentionDays * 86400000 || total > maxTotalBytes) {
                unlinkSync(join(directory, file.name)); total -= file.bytes;
            }
        }
        lastCleanup = date.getTime();
    };
    function write(level, event, details = {}) {
        try {
            const date = now();
            const record = { time: date.toISOString(), level, event: safeText(event), sessionId, pid: process.pid, details: sanitizeLog(details) };
            const line = `${JSON.stringify(record)}\n`;
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            const prefix = `diagnostic-${date.toISOString().slice(0, 10)}-`;
            const rotate = !current.startsWith(prefix) || size + Buffer.byteLength(line) > maxFileBytes;
            if (rotate) { current = `${prefix}${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`; size = 0; }
            appendFileSync(join(directory, current), line, { mode: 0o600 });
            size += Buffer.byteLength(line);
            if (rotate || date.getTime() - lastCleanup > 60000) cleanup(date);
            lastWriteAt = record.time; lastError = null;
            return true;
        } catch (error) { lastError = safeText(`${error.code || ""} ${error.message}`); return false; }
    }
    function status() {
        try {
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            cleanup(now());
            return { directory, sessionId, lastWriteAt, lastError, retentionDays, maxFileBytes, maxTotalBytes, files: list().map(({ time, ...file }) => file) };
        } catch (error) { lastError = safeText(error.message); return { directory, sessionId, lastError, lastWriteAt, retentionDays, maxFileBytes, maxTotalBytes, files: [] }; }
    }
    function exportZip() {
        write("info", "diagnostics.export");
        const info = status();
        if (info.lastError) throw new Error(`日志不可读：${info.lastError}`);
        const files = {}, selected = [];
        let bytes = 0;
        for (const file of [...info.files].reverse()) {
            if (bytes + file.bytes > 20 * 1024 * 1024) break;
            files[file.name] = new Uint8Array(readFileSync(join(directory, file.name)));
            bytes += file.bytes; selected.push(file.name);
        }
        files["README.txt"] = strToU8(`Santu Infinite Canvas diagnostic logs\nExport: ${now().toISOString()}\nPlatform: ${process.platform} ${process.arch}\nNode: ${process.versions.node}\nLatest files, up to 20 MiB. Selected ${selected.length}/${info.files.length} files.\nTimes are UTC (China = UTC+8). One JSON record per line.\nNo request bodies, prompt text or image binaries are collected.\n${selected.join("\n")}\n`);
        return Buffer.from(zipSync(files, { level: 1 }));
    }
    return { write, status, exportZip };
}

let singleton;
export function diagnosticLogger() {
    return singleton ||= createDiagnosticLogger({ directory: process.env.CANVAS_LOG_PATH || join(dirname(resolve(process.env.CANVAS_DB_PATH || "server/data/app-db.json")), "logs") });
}
export function logEvent(level, event, details) { return diagnosticLogger().write(level, event, details); }
