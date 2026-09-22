import { readProductPage } from "./server/lib/creative-product-page.js";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clearCanvasCache, getCanvasBootstrap, pushCanvasProjects } from "./server/lib/canvas-sync.js";
import { listLocalApiSettings, updateLocalApiSetting } from "./server/lib/backend-api-config.js";
import { proxyBackendApi } from "./server/lib/backend-api-proxy.js";
import { getStorageObject, putStorageObject } from "./server/lib/storage-objects.js";
import { applyAssetMutations, getAssetBootstrap, getAssetChanges, pushAssetLibrary } from "./server/lib/asset-sync.js";
import { createGenerationRun, getGenerationRun, listGenerationRuns, retryGenerationRun, transitionGenerationRun } from "./server/lib/generation-runs.js";
import { listModelCatalog } from "./server/lib/model-catalog.js";
import { localWorkspace } from "./server/lib/local-workspace.js";
import { createDirectorExport, deleteDirectorProject, getDirectorAssetContent, getDirectorProject, putDirectorProject } from "./server/lib/director-projects.js";
import { getUiPreferences, updateUiPreferences } from "./server/lib/ui-preferences.js";
import {
    copyPromptLibraryItem,
    createPromptLibraryFolder,
    createPromptLibraryItem,
    deletePromptLibraryFolder,
    deletePromptLibraryItem,
    getPromptLibraryImage,
    listPromptLibrary,
    updatePromptLibraryFolder,
    updatePromptLibraryItem,
} from "./server/lib/prompt-library.js";

const rootDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(process.env.CANVAS_DIST_PATH || resolve(rootDir, "dist"));
const maxBodyBytes = 80 * 1024 * 1024;

const server = createServer(async (req, res) => {
    try {
        if (!req.url) return sendJson(res, 404, { error: "接口不存在", code: "route_not_found", path: "" });
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url.pathname);

        if (req.method === "GET" && url.pathname === "/api/health") {
            return sendJson(res, 200, { ok: true });
        }

        const user = localWorkspace;
        if (req.method === "GET" && url.pathname === "/api/creative/product-page") {
            try { return sendJson(res, 200, await readProductPage(url.searchParams.get("url") || "")); }
            catch (error) { return sendJson(res, 400, { error: error.message }); }
        }

        if (req.method === "GET" && url.pathname === "/api/workspace") {
            return sendJson(res, 200, { workspace: user });
        }

        if (req.method === "GET" && url.pathname === "/api/settings/apis") {
            return sendJson(res, 200, { apis: await listLocalApiSettings() });
        }

        if (req.method === "GET" && url.pathname === "/api/settings/preferences") {
            return sendJson(res, 200, { preferences: await getUiPreferences() });
        }

        if (req.method === "PUT" && url.pathname === "/api/settings/preferences") {
            return sendJson(res, 200, { preferences: await updateUiPreferences(await readJson(req)) });
        }

        const apiSettingMatch = url.pathname.match(/^\/api\/settings\/apis\/(image|text|video|audio|music)$/);
        if (apiSettingMatch && req.method === "PUT") {
            return sendJson(res, 200, { config: await updateLocalApiSetting(apiSettingMatch[1], await readJson(req)) });
        }

        if (url.pathname.startsWith("/api/ai/")) {
            await proxyBackendApi(req, res, `${url.pathname}${url.search}`, user);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/models/catalog") {
            return sendJson(res, 200, { models: await listModelCatalog(user, { capability: url.searchParams.get("capability") || "" }) });
        }

        if (req.method === "POST" && url.pathname === "/api/generation-runs") {
            const body = await readJson(req);
            const run = await createGenerationRun(user.id, body);
            return sendJson(res, run.created === false ? 200 : 201, { run });
        }

        if (req.method === "GET" && url.pathname === "/api/generation-runs") {
            return sendJson(
                res,
                200,
                await listGenerationRuns(user.id, {
                    status: url.searchParams.get("status") || "",
                    capability: url.searchParams.get("capability") || "",
                    projectId: url.searchParams.get("projectId") || "",
                    keyword: url.searchParams.get("keyword") || "",
                    cursor: url.searchParams.get("cursor") || "0",
                    limit: url.searchParams.get("limit") || "50",
                }),
            );
        }

        const generationRunRetryMatch = url.pathname.match(/^\/api\/generation-runs\/([^/]+)\/retry$/);
        if (req.method === "POST" && generationRunRetryMatch) {
            return sendJson(res, 201, { run: await retryGenerationRun(user.id, decodeURIComponent(generationRunRetryMatch[1])) });
        }

        const generationRunMatch = url.pathname.match(/^\/api\/generation-runs\/([^/]+)$/);
        if (generationRunMatch && req.method === "GET") {
            return sendJson(res, 200, { run: await getGenerationRun(user.id, decodeURIComponent(generationRunMatch[1])) });
        }
        if (generationRunMatch && req.method === "PATCH") {
            const body = await readJson(req);
            const { usageEventId: _usageEventId, ...clientPatch } = body;
            return sendJson(res, 200, { run: await transitionGenerationRun(user.id, decodeURIComponent(generationRunMatch[1]), clientPatch.status, clientPatch) });
        }

        const directorExportMatch = url.pathname.match(/^\/api\/director-projects\/([^/]+)\/export$/);
        if (directorExportMatch && req.method === "POST") {
            const nodeId = decodeURIComponent(directorExportMatch[1]);
            const buffer = await readRawBody(req);
            return sendJson(
                res,
                201,
                await createDirectorExport({
                    userId: user.id,
                    nodeId,
                    kind: url.searchParams.get("kind") || "",
                    exportId: url.searchParams.get("exportId") || "",
                    buffer,
                    mimeType: req.headers["content-type"] || "",
                    width: url.searchParams.get("width"),
                    height: url.searchParams.get("height"),
                    durationMs: url.searchParams.get("durationMs"),
                    canvasProjectId: url.searchParams.get("canvasProjectId") || "",
                    sourceNodeIds: url.searchParams.getAll("sourceNodeId"),
                    clientIp: clientIp(req),
                }),
            );
        }

        const directorProjectMatch = url.pathname.match(/^\/api\/director-projects\/([^/]+)$/);
        if (directorProjectMatch && req.method === "GET") {
            return sendJson(res, 200, await getDirectorProject(user.id, decodeURIComponent(directorProjectMatch[1])));
        }
        if (directorProjectMatch && req.method === "PUT") {
            return sendJson(res, 200, await putDirectorProject(user.id, decodeURIComponent(directorProjectMatch[1]), await readJson(req)));
        }
        if (directorProjectMatch && req.method === "DELETE") {
            return sendJson(res, 200, await deleteDirectorProject(user.id, decodeURIComponent(directorProjectMatch[1])));
        }

        const directorAssetContentMatch = url.pathname.match(/^\/api\/director-assets\/([^/]+)\/content$/);
        if (directorAssetContentMatch && req.method === "GET") {
            const object = await getDirectorAssetContent(user.id, decodeURIComponent(directorAssetContentMatch[1]));
            res.statusCode = 200;
            res.setHeader("Content-Type", object.mimeType);
            res.setHeader("Content-Length", String(object.bytes));
            res.setHeader("Cache-Control", "private, max-age=3600");
            return res.end(object.buffer);
        }

        const storageImageMatch = url.pathname.match(/^\/api\/storage\/images\/([^/]+)$/);
        if (storageImageMatch && req.method === "PUT") {
            const storageKey = decodeURIComponent(storageImageMatch[1]);
            const body = await readRawBody(req);
            return sendJson(res, 200, await putStorageObject(user.id, storageKey, body, req.headers["content-type"] || "image/png", req.headers["x-canvas-cache-key"] || ""));
        }

        if (storageImageMatch && req.method === "GET") {
            const storageKey = decodeURIComponent(storageImageMatch[1]);
            const object = await getStorageObject(user.id, storageKey);
            res.statusCode = 200;
            res.setHeader("Content-Type", object.mimeType);
            res.setHeader("Content-Length", String(object.bytes));
            res.setHeader("Cache-Control", "private, max-age=3600");
            return res.end(object.buffer);
        }

        const storageMediaMatch = url.pathname.match(/^\/api\/storage\/media\/([^/]+)$/);
        if (storageMediaMatch && req.method === "PUT") {
            const storageKey = decodeURIComponent(storageMediaMatch[1]);
            const body = await readRawBody(req);
            return sendJson(res, 200, await putStorageObject(user.id, storageKey, body, req.headers["content-type"] || "application/octet-stream", ""));
        }

        if (storageMediaMatch && req.method === "GET") {
            const storageKey = decodeURIComponent(storageMediaMatch[1]);
            const object = await getStorageObject(user.id, storageKey);
            res.statusCode = 200;
            res.setHeader("Content-Type", object.mimeType);
            res.setHeader("Content-Length", String(object.bytes));
            res.setHeader("Cache-Control", "private, max-age=3600");
            return res.end(object.buffer);
        }

        if (req.method === "GET" && url.pathname === "/api/sync/bootstrap") {
            return sendJson(res, 200, await getCanvasBootstrap(user.id));
        }

        if (req.method === "GET" && url.pathname === "/api/assets/bootstrap") {
            return sendJson(res, 200, await getAssetBootstrap(user.id));
        }

        if (req.method === "POST" && url.pathname === "/api/assets/push") {
            const body = await readJson(req);
            return sendJson(res, 200, await pushAssetLibrary(user.id, body.assets, body.folders, body.expectedRevision));
        }

        if (req.method === "POST" && url.pathname === "/api/assets/mutations") {
            const body = await readJson(req);
            return sendJson(res, 200, await applyAssetMutations(user.id, body.operations, body.expectedRevision));
        }

        if (req.method === "GET" && url.pathname === "/api/assets/changes") {
            return sendJson(res, 200, await getAssetChanges(user.id, url.searchParams.get("afterRevision") || "0", url.searchParams.get("limit") || "100"));
        }

        if (req.method === "GET" && url.pathname === "/api/prompt-library") {
            return sendJson(
                res,
                200,
                await listPromptLibrary(user, {
                    scope: url.searchParams.get("scope") || "personal",
                    folder: url.searchParams.get("folder") || "all",
                    keyword: url.searchParams.get("keyword") || "",
                    cursor: url.searchParams.get("cursor") || "",
                    limit: url.searchParams.get("limit") || "50",
                }),
            );
        }

        if (req.method === "POST" && url.pathname === "/api/prompt-library/items") {
            return sendJson(res, 201, await createPromptLibraryItem(user, await readJson(req)));
        }

        const promptItemImageMatch = url.pathname.match(/^\/api\/prompt-library\/items\/([^/]+)\/image$/);
        if (req.method === "GET" && promptItemImageMatch) {
            const object = await getPromptLibraryImage(user, decodeURIComponent(promptItemImageMatch[1]));
            res.statusCode = 200;
            res.setHeader("Content-Type", object.mimeType);
            res.setHeader("Content-Length", String(object.bytes));
            res.setHeader("Cache-Control", "private, max-age=3600");
            return res.end(object.buffer);
        }

        const promptItemCopyMatch = url.pathname.match(/^\/api\/prompt-library\/items\/([^/]+)\/copy$/);
        if (req.method === "POST" && promptItemCopyMatch) {
            return sendJson(res, 201, await copyPromptLibraryItem(user, decodeURIComponent(promptItemCopyMatch[1]), await readJson(req)));
        }

        const promptItemMatch = url.pathname.match(/^\/api\/prompt-library\/items\/([^/]+)$/);
        if (req.method === "PATCH" && promptItemMatch) {
            return sendJson(res, 200, await updatePromptLibraryItem(user, decodeURIComponent(promptItemMatch[1]), await readJson(req)));
        }
        if (req.method === "DELETE" && promptItemMatch) {
            return sendJson(res, 200, await deletePromptLibraryItem(user, decodeURIComponent(promptItemMatch[1])));
        }

        if (req.method === "POST" && url.pathname === "/api/prompt-library/folders") {
            return sendJson(res, 201, await createPromptLibraryFolder(user, await readJson(req)));
        }

        const promptFolderMatch = url.pathname.match(/^\/api\/prompt-library\/folders\/([^/]+)$/);
        if (req.method === "PATCH" && promptFolderMatch) {
            return sendJson(res, 200, await updatePromptLibraryFolder(user, decodeURIComponent(promptFolderMatch[1]), await readJson(req)));
        }
        if (req.method === "DELETE" && promptFolderMatch) {
            return sendJson(res, 200, await deletePromptLibraryFolder(user, decodeURIComponent(promptFolderMatch[1])));
        }

        if (req.method === "POST" && url.pathname === "/api/sync/push") {
            const body = await readJson(req);
            return sendJson(res, 200, await pushCanvasProjects(user.id, body.projects));
        }

        if (req.method === "POST" && url.pathname === "/api/sync/clear-cache") {
            return sendJson(res, 200, await clearCanvasCache(user.id));
        }

        return sendJson(res, 404, { error: "接口不存在", code: "route_not_found", path: url.pathname });
    } catch (error) {
        const status = Number(error.statusCode || 500);
        return sendJson(res, status, { error: error instanceof Error ? error.message : "Server error", ...(error?.conflict ? { conflict: error.conflict } : {}) });
    }
});

export function startServer({ port = Number(process.env.PORT || process.env.BACKEND_PORT || 5200), host = process.env.HOST || process.env.BACKEND_HOST || "127.0.0.1" } = {}) {
    return new Promise((resolveStart, rejectStart) => {
        const onError = (error) => {
            server.off("listening", onListening);
            rejectStart(error);
        };
        const onListening = () => {
            server.off("error", onError);
            const address = server.address();
            const actualPort = typeof address === "object" && address ? address.port : port;
            console.log(`Santu Infinite Canvas listening on http://${host}:${actualPort}`);
            resolveStart({ server, host, port: actualPort, url: `http://${host}:${actualPort}` });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
}

export function stopServer() {
    return new Promise((resolveStop, rejectStop) => {
        if (!server.listening) return resolveStop();
        server.close((error) => (error ? rejectStop(error) : resolveStop()));
    });
}

function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
}

async function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "仅支持读取静态资源" });
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        return sendJson(res, 400, { error: "路径格式错误" });
    }
    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const candidate = resolve(distDir, relativePath);
    const distPrefix = distDir.endsWith(sep) ? distDir : `${distDir}${sep}`;
    if (candidate !== distDir && !candidate.startsWith(distPrefix)) return sendJson(res, 403, { error: "禁止访问该路径" });
    const candidateExists = await isFile(candidate);
    if (!candidateExists && extname(relativePath)) return sendJson(res, 404, { error: "静态资源不存在" });
    const filePath = candidateExists ? candidate : resolve(distDir, "index.html");
    try {
        const body = await readFile(filePath);
        res.statusCode = 200;
        res.setHeader("Content-Type", mimeType(filePath));
        res.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
        res.setHeader("Content-Length", String(body.length));
        return req.method === "HEAD" ? res.end() : res.end(body);
    } catch {
        return sendJson(res, 503, { error: "前端尚未构建，请先运行 pnpm build" });
    }
}

async function isFile(path) {
    return stat(path)
        .then((entry) => entry.isFile())
        .catch(() => false);
}

function mimeType(path) {
    return (
        {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
            ".mp3": "audio/mpeg",
            ".mp4": "video/mp4",
        }[extname(path).toLowerCase()] || "application/octet-stream"
    );
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBodyBytes) {
                const error = new Error("请求体过大");
                error.statusCode = 413;
                reject(error);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8").trim();
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                const error = new Error("JSON 格式错误");
                error.statusCode = 400;
                reject(error);
            }
        });
        req.on("error", reject);
    });
}

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBodyBytes) {
                const error = new Error("请求体过大");
                error.statusCode = 413;
                reject(error);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function clientIp(req) {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim();
    return forwarded || req.socket.remoteAddress || "";
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
    startServer().catch((error) => {
        console.error(`Santu Infinite Canvas failed to start: ${error.message}`);
        process.exitCode = 1;
    });
}
