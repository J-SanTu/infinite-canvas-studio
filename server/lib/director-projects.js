import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertOwnedProject, createGenerationRunRecord, publicGenerationRun } from "./generation-runs.js";
import { createId, readDb, updateDb } from "./store.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const storageRoot = process.env.CANVAS_STORAGE_PATH ? resolve(process.env.CANVAS_STORAGE_PATH) : resolve(serverDir, "data/storage");
const MAX_PROJECT_CHARS = 2 * 1024 * 1024;
const MAX_EXPORT_BYTES = 80 * 1024 * 1024;

export async function getDirectorProject(userId, nodeId) {
    const safeNodeId = normalizeNodeId(nodeId);
    const db = await readDb();
    const project = db.directorProjects.find((item) => item.userId === userId && item.directorNodeId === safeNodeId && !item.deletedAt);
    return { project: project ? publicDirectorProject(project) : null };
}

export async function putDirectorProject(userId, nodeId, input = {}) {
    const safeNodeId = normalizeNodeId(nodeId);
    const projectJson = normalizeProjectJson(input.projectJson);
    const canvasProjectId = normalizeOptionalId(input.canvasProjectId);
    return updateDb((db) => {
        assertOwnedProject(db, userId, canvasProjectId);
        const now = new Date().toISOString();
        let project = db.directorProjects.find((item) => item.userId === userId && item.directorNodeId === safeNodeId);
        if (!project) {
            project = { id: createId("director_project"), userId, directorNodeId: safeNodeId, createdAt: now };
            db.directorProjects.push(project);
        }
        project.canvasProjectId = canvasProjectId;
        project.schemaVersion = 1;
        project.projectJson = projectJson;
        project.deletedAt = null;
        project.updatedAt = now;
        return { project: publicDirectorProject(project) };
    });
}

export async function deleteDirectorProject(userId, nodeId) {
    const safeNodeId = normalizeNodeId(nodeId);
    return updateDb((db) => {
        const project = db.directorProjects.find((item) => item.userId === userId && item.directorNodeId === safeNodeId && !item.deletedAt);
        if (!project) return { deleted: false };
        project.deletedAt = new Date().toISOString();
        project.updatedAt = project.deletedAt;
        return { deleted: true };
    });
}

export async function createDirectorExport({ userId, nodeId, kind, exportId, buffer, mimeType, width, height, durationMs, clientIp, canvasProjectId, sourceNodeIds }) {
    const safeNodeId = normalizeNodeId(nodeId);
    const normalized = normalizeExport(kind, buffer, mimeType);
    const safeCanvasProjectId = normalizeOptionalId(canvasProjectId);
    const safeExportId = normalizeExportId(exportId);
    const requestId = `director_export_${safeExportId}`;
    const safeSourceNodeIds = normalizeSourceNodeIds(sourceNodeIds);
    const preflightDb = await readDb();
    assertOwnedProject(preflightDb, userId, safeCanvasProjectId);
    const duplicate = findExistingExport(preflightDb, userId, requestId);
    if (duplicate) return duplicate;
    assertActiveDirectorProject(preflightDb, userId, safeNodeId, safeCanvasProjectId);

    const now = new Date();
    const assetId = createId("director_asset");
    const storageKey = normalized.kind === "image" ? `image:${assetId}` : `video:${assetId}`;
    const date = now.toISOString().slice(0, 10);
    const path = resolve(storageRoot, safePathPart(clientIp || "local"), date, `${assetId}.${normalized.extension}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, normalized.buffer);

    try {
        const committed = await updateDb((db) => {
            assertOwnedProject(db, userId, safeCanvasProjectId);
            const existing = findExistingExport(db, userId, requestId);
            if (existing) return { ...existing, duplicate: true };
            const project = assertActiveDirectorProject(db, userId, safeNodeId, safeCanvasProjectId);
            const timestamp = now.toISOString();
            db.storageObjects.push({
                id: createId("storage"),
                userId,
                storageKey,
                mimeType: normalized.mimeType,
                bytes: normalized.buffer.length,
                path,
                source: "director",
                createdAt: timestamp,
                updatedAt: timestamp,
            });
            const publicAsset = buildDirectorAsset({ assetId, storageKey, nodeId: safeNodeId, directorProjectId: project.id, canvasProjectId: safeCanvasProjectId, sourceNodeIds: safeSourceNodeIds, kind: normalized.kind, mimeType: normalized.mimeType, bytes: normalized.buffer.length, width, height, durationMs, timestamp });
            db.assets.push({
                id: createId("asset"),
                userId,
                localAssetId: assetId,
                storageKey,
                folderId: null,
                title: publicAsset.title,
                kind: normalized.kind,
                assetJson: JSON.stringify(publicAsset),
                createdAt: timestamp,
                updatedAt: timestamp,
            });
            if (normalized.kind === "image") {
                project.previewAssetId = assetId;
                project.updatedAt = timestamp;
            }
            const run = createGenerationRunRecord(db, userId, {
                requestId,
                projectId: safeCanvasProjectId,
                targetNodeId: safeNodeId,
                sourceNodeIds: safeSourceNodeIds,
                operation: normalized.kind === "image" ? "director_export_image" : "director_export_video",
                capability: "director",
                modelId: "monoform",
                providerId: "local-director",
                status: "succeeded",
                outputAssetIds: [assetId],
                inputSnapshot: { directorNodeId: safeNodeId, directorProjectId: project.id },
                parameterSnapshot: { mimeType: normalized.mimeType, width: boundedPositiveInteger(width, 16_384), height: boundedPositiveInteger(height, 16_384), durationMs: boundedPositiveInteger(durationMs, 60_000) },
            });
            return { asset: publicAsset, run, duplicate: false };
        });
        if (committed.duplicate) await unlink(path).catch(() => undefined);
        return { asset: committed.asset, run: committed.run };
    } catch (error) {
        await unlink(path).catch(() => undefined);
        throw error;
    }
}

export async function getDirectorAssetContent(userId, assetId) {
    const safeAssetId = normalizeNodeId(assetId);
    const db = await readDb();
    const asset = db.assets.find((item) => item.userId === userId && (item.localAssetId === safeAssetId || item.id === safeAssetId));
    if (!asset) throw notFound("素材不存在");
    const storage = db.storageObjects.find((item) => item.userId === userId && item.storageKey === asset.storageKey);
    if (!storage?.path) throw notFound("素材文件不存在");
    try {
        const buffer = await readFile(storage.path);
        return { buffer, mimeType: storage.mimeType || "application/octet-stream", bytes: buffer.length };
    } catch {
        throw notFound("素材文件不存在");
    }
}

function buildDirectorAsset({ assetId, storageKey, nodeId, directorProjectId, canvasProjectId, sourceNodeIds, kind, mimeType, bytes, width, height, durationMs, timestamp }) {
    const safeWidth = boundedPositiveInteger(width, 16_384) || 1920;
    const safeHeight = boundedPositiveInteger(height, 16_384) || 1080;
    const safeDurationMs = boundedPositiveInteger(durationMs, 60_000) || undefined;
    const metadata = { directorNodeId: nodeId, directorProjectId, canvasProjectId, sourceNodeIds, ...(safeDurationMs ? { durationMs: safeDurationMs } : {}) };
    if (kind === "image") {
        return {
            id: assetId,
            kind: "image",
            title: "导演台截图",
            coverUrl: "",
            tags: ["Director", "Santu"],
            folderId: null,
            source: "director",
            createdAt: timestamp,
            updatedAt: timestamp,
            metadata,
            data: { dataUrl: "", storageKey, width: safeWidth, height: safeHeight, bytes, mimeType },
        };
    }
    return {
        id: assetId,
        kind: "video",
        title: "导演台预演",
        coverUrl: "",
        tags: ["Director", "Santu"],
        folderId: null,
        source: "director",
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata,
        data: { url: `/api/director-assets/${encodeURIComponent(assetId)}/content`, storageKey, width: safeWidth, height: safeHeight, durationMs: safeDurationMs, bytes, mimeType },
    };
}

function publicDirectorProject(project) {
    return {
        id: project.id,
        canvasProjectId: project.canvasProjectId || null,
        directorNodeId: project.directorNodeId,
        schemaVersion: project.schemaVersion || 1,
        projectJson: project.projectJson || "",
        previewAssetId: project.previewAssetId || null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

function normalizeProjectJson(value) {
    const projectJson = typeof value === "string" ? value : JSON.stringify(value || {});
    if (!projectJson || projectJson.length > MAX_PROJECT_CHARS) throw payloadTooLarge("导演工程超过 2 MB 限制");
    try {
        const parsed = JSON.parse(projectJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    } catch {
        throw badRequest("导演工程 JSON 不合法");
    }
    return projectJson;
}

function normalizeExport(kind, buffer, mimeType) {
    if (!buffer?.length) throw badRequest("导出文件不能为空");
    if (buffer.length > MAX_EXPORT_BYTES) throw payloadTooLarge("导演导出超过 80 MB 限制");
    const type = String(mimeType || "").toLowerCase().split(";", 1)[0].trim();
    if (kind === "image" && ["image/png", "image/jpeg", "image/webp"].includes(type)) {
        return { kind: "image", buffer, mimeType: type, extension: type === "image/jpeg" ? "jpg" : type.split("/")[1] };
    }
    if (kind === "video" && type === "video/mp4") return { kind: "video", buffer, mimeType: type, extension: "mp4" };
    throw badRequest("导演导出格式不受支持");
}

function normalizeNodeId(value) {
    const id = String(value || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw badRequest("Director ID 不合法");
    return id;
}

function normalizeOptionalId(value) {
    const id = String(value || "").trim();
    return id ? normalizeNodeId(id) : null;
}

function boundedPositiveInteger(value, max) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(max, Math.round(number)) : 0;
}

function normalizeExportId(value) {
    const id = String(value || "").trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw badRequest("Director export ID 不合法");
    return id;
}

function normalizeSourceNodeIds(value) {
    return Array.from(new Set((Array.isArray(value) ? value : []).map(normalizeNodeId))).slice(0, 50);
}

function assertActiveDirectorProject(db, userId, nodeId, canvasProjectId) {
    const project = db.directorProjects.find((item) => item.userId === userId && item.directorNodeId === nodeId && !item.deletedAt);
    if (!project) throw badRequest("请先保存导演工程再导出");
    if ((project.canvasProjectId || null) !== (canvasProjectId || null)) throw conflict("导演工程与导出画布不匹配");
    return project;
}

function findExistingExport(db, userId, requestId) {
    const storedRun = db.generationRuns.find((run) => run.userId === userId && run.requestId === requestId);
    if (!storedRun) return null;
    const assetId = storedRun.outputAssetIds?.[0];
    const storedAsset = db.assets.find((asset) => asset.userId === userId && (asset.localAssetId === assetId || asset.id === assetId));
    if (!storedAsset?.assetJson) throw conflict("导演导出幂等记录不完整");
    return { asset: JSON.parse(storedAsset.assetJson), run: publicGenerationRun(storedRun) };
}

function safePathPart(value) {
    return String(value || "local").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128) || "local";
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function payloadTooLarge(message) {
    const error = new Error(message);
    error.statusCode = 413;
    return error;
}

function conflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

function notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
}
