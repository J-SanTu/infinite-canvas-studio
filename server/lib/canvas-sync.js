import { createId, readDb, updateDb } from "./store.js";
import { deleteAssetChangeRecords, initializeAssetChangeRepository } from "./asset-change-repository.js";

export async function getCanvasBootstrap(userId) {
    const db = await readDb();
    const projects = db.canvasProjects
        .filter((project) => project.userId === userId && !project.deletedAt)
        .map((project) => ({
            serverId: project.id,
            localProjectId: project.localProjectId,
            version: project.version,
            updatedAt: project.updatedAt,
            project: JSON.parse(project.canvasJson),
        }));
    return { projects };
}

export async function pushCanvasProjects(userId, projects) {
    if (!Array.isArray(projects)) throw badRequest("projects 必须是数组");
    return updateDb((db) => {
        const now = new Date().toISOString();
        const saved = [];

        for (const entry of projects) {
            const project = entry?.project && typeof entry.project === "object" ? entry.project : entry;
            if (!project || typeof project !== "object") continue;
            if (!project.id || !project.title) continue;
            const localProjectId = String(project.id);
            const expectedVersion = Number(entry?.expectedVersion ?? project.expectedVersion ?? 0);
            if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw badRequest("画布项目版本不合法");
            const serialized = JSON.stringify(project);
            if (serialized.length > 8 * 1024 * 1024) throw payloadTooLarge("画布项目超过 8 MB 限制");
            const existing = db.canvasProjects.find((item) => item.userId === userId && item.localProjectId === localProjectId);
            if (existing && expectedVersion !== Number(existing.version || 0)) {
                throw conflict("画布项目已被其他窗口更新，请重新加载后再保存", { conflict: { localProjectId, currentVersion: Number(existing.version || 0), updatedAt: existing.updatedAt } });
            }
            if (existing && !existing.deletedAt && existing.canvasJson === serialized) {
                saved.push({ serverId: existing.id, localProjectId, version: Number(existing.version || 0), updatedAt: existing.updatedAt });
                continue;
            }
            const row = existing || {
                id: createId("canvas"),
                userId,
                localProjectId,
                version: 0,
                createdAt: project.createdAt || now,
                deletedAt: null,
            };
            row.title = String(project.title || "未命名画布");
            row.canvasJson = serialized;
            row.version = Number(row.version || 0) + 1;
            row.updatedAt = project.updatedAt || now;
            row.deletedAt = null;
            if (!existing) db.canvasProjects.push(row);
            saved.push({ serverId: row.id, localProjectId, version: row.version, updatedAt: row.updatedAt });
        }

        return { saved };
    });
}

export async function clearCanvasCache(userId) {
    return updateDb((db) => {
        const beforeProjects = db.canvasProjects.length;
        const beforeObjects = db.storageObjects.length;
        const beforeAssets = db.assets.length;
        const beforeAssetFolders = db.assetFolders.length;
        db.canvasProjects = db.canvasProjects.filter((project) => project.userId !== userId);
        db.storageObjects = db.storageObjects.filter((object) => object.userId !== userId);
        db.assets = db.assets.filter((asset) => asset.userId !== userId);
        db.assetFolders = db.assetFolders.filter((folder) => folder.userId !== userId);
        db.assetLibraryRevisions = db.assetLibraryRevisions.filter((item) => item.userId !== userId);
        db.assetLibraryChanges = db.assetLibraryChanges.filter((item) => item.userId !== userId);
        initializeAssetChangeRepository(db.assetLibraryChanges);
        deleteAssetChangeRecords(userId);
        return {
            clearedProjects: beforeProjects - db.canvasProjects.length,
            clearedObjects: beforeObjects - db.storageObjects.length,
            clearedAssets: beforeAssets - db.assets.length,
            clearedAssetFolders: beforeAssetFolders - db.assetFolders.length,
        };
    });
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function conflict(message, details = {}) {
    const error = new Error(message);
    error.statusCode = 409;
    Object.assign(error, details);
    return error;
}

function payloadTooLarge(message) {
    const error = new Error(message);
    error.statusCode = 413;
    return error;
}
