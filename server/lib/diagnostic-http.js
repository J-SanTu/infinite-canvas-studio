import { randomUUID } from "node:crypto";
import { diagnosticLogger, logEvent } from "./diagnostic-log.js";

let openDirectory = null;
export function setDiagnosticDirectoryOpener(callback) { openDirectory = callback; }

export function traceRequest(req, res) {
    const path = String(req.url || "").split("?")[0];
    if (!path.startsWith("/api/") || path.startsWith("/api/diagnostics")) return;
    const raw = req.headers["x-canvas-request-id"];
    const requestId = typeof raw === "string" && /^[\w:.-]{8,160}$/.test(raw) ? raw : randomUUID();
    req.diagnosticRequestId = requestId;
    res.setHeader("X-Canvas-Request-Id", requestId);
    const started = performance.now();
    const context = { requestId, method: req.method, path };
    logEvent("info", "http.request.start", context);
    res.once("finish", () => logEvent(res.statusCode >= 400 ? "warn" : "info", "http.request.end", { ...context, status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
    res.once("close", () => { if (!res.writableFinished) logEvent("warn", "http.request.disconnected", { ...context, durationMs: Math.round(performance.now() - started) }); });
}

// Diagnostics routes only accept same-origin requests; no arbitrary filesystem paths.
export async function handleDiagnostics(req, res, path) {
    if (!path.startsWith("/api/diagnostics")) return false;
    const reply = (status, data) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); return true; };
    if (req.headers["sec-fetch-site"] === "cross-site" || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`)) return reply(403, { error: "仅允许本机应用访问诊断日志" });
    if (req.method === "GET" && path === "/api/diagnostics") return reply(200, { ...diagnosticLogger().status(), canOpenDirectory: Boolean(openDirectory) });
    if (req.method === "POST" && path === "/api/diagnostics/open") {
        if (!openDirectory) return reply(400, { error: "请按显示的路径手动打开日志文件夹" });
        await openDirectory(diagnosticLogger().status().directory);
        logEvent("info", "diagnostics.open_directory");
        return reply(200, { ok: true });
    }
    if (req.method === "GET" && path === "/api/diagnostics/export") {
        const archive = diagnosticLogger().exportZip();
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Santu-diagnostics-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "no-store", "Content-Length": archive.length });
        res.end(archive); return true;
    }
    if (req.method === "POST" && path === "/api/diagnostics/events") {
        let size = 0; const chunks = [];
        for await (const chunk of req) {
            size += chunk.length;
            if (size > 64 * 1024) return reply(413, { error: "诊断事件过大" });
            chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(400, { error: "诊断事件格式错误" }); }
        if (!Array.isArray(body.events) || body.events.length > 50) return reply(400, { error: "诊断事件数量错误" });
        let ok = true;
        for (const item of body.events) {
            if (!item || !/^[\w.-]{1,100}$/.test(item.event)) continue;
            // Ignore arbitrary payloads. Only metadata emitted by our instrumentation is accepted.
            const details = {};
            for (const key of ["eventId", "clientTime", "page", "action", "operationId", "projectId", "field", "fields", "count", "nodeCount", "durationMs", "status", "method", "path", "requestId", "tag", "role", "controlType", "shortcut", "error", "dropped", "version"])
                if (Object.hasOwn(item, key)) details[key] = item[key];
            ok = logEvent(["error", "warn"].includes(item.level) ? item.level : "info", `renderer.${item.event}`, details) && ok;
        }
        return reply(ok ? 200 : 503, ok ? { ok: true } : { error: "日志写入失败，请查看诊断页" });
    }
    return reply(404, { error: "诊断接口不存在" });
}
