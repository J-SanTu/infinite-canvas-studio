import { appendAssetChangeRecord, initializeAssetChangeRepository, listAssetChangeRecords } from "./asset-change-repository.js";
import { createId, readDb, updateDb } from "./store.js";

export async function getAssetBootstrap(userId) {
    const db = await readDb();
    const folders = db.assetFolders
        .filter((folder) => folder.userId === userId)
        .map((folder) => ({
            id: folder.localFolderId,
            name: folder.name,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
        }))
        .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt));
    const folderIds = new Set(folders.map((folder) => folder.id));
    const assets = db.assets
        .filter((asset) => asset.userId === userId)
        .map((asset) => parseAsset(asset.assetJson))
        .filter(Boolean)
        .map((asset) => ({ ...asset, folderId: asset.folderId && folderIds.has(asset.folderId) ? asset.folderId : null }))
        .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
    const revisionRow = db.assetLibraryRevisions.find((item) => item.userId === userId);
    return { assets, folders, revision: Number(revisionRow?.revision || 0) };
}

export async function getAssetChanges(userId, afterRevision = 0, limit = 100) {
    const after = Number(afterRevision);
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    if (!Number.isInteger(after) || after < 0) throw badRequest("afterRevision 不合法");
    const db = await readDb();
    initializeAssetChangeRepository(db.assetLibraryChanges);
    const revisionRow = db.assetLibraryRevisions.find((item) => item.userId === userId);
    const currentRevision = Number(revisionRow?.revision || 0);
    const changes = listAssetChangeRecords(userId, after, boundedLimit);
    return { changes, currentRevision, hasMore: changes.length === boundedLimit && changes.at(-1)?.revision < currentRevision };
}

export async function pushAssetLibrary(userId, assets, folders, expectedRevision = 0) {
    if (!Array.isArray(assets)) throw badRequest("assets 必须是数组");
    if (!Array.isArray(folders)) throw badRequest("folders 必须是数组");
    if (assets.length > 10000 || folders.length > 1000) throw badRequest("素材库数据量超出限制");

    const normalizedFolders = normalizeFolders(folders);
    const folderIds = new Set(normalizedFolders.map((folder) => folder.id));
    const normalizedAssets = assets.map((asset) => normalizeAsset(asset, folderIds));

    return updateDb((db) => {
        const revisionRow = db.assetLibraryRevisions.find((item) => item.userId === userId);
        const currentRevision = Number(revisionRow?.revision || 0);
        if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) throw badRequest("素材库 revision 不合法");
        if (Number(expectedRevision) !== currentRevision) throw conflict("素材库已被其他窗口更新，请重新加载后再保存", { conflict: { currentRevision } });
        const ownedStorageKeys = new Set(db.storageObjects.filter((object) => object.userId === userId).map((object) => object.storageKey));
        const missingStorageAsset = normalizedAssets.find((asset) => (asset.kind === "image" || asset.kind === "audio") && asset.data.storageKey && !ownedStorageKeys.has(asset.data.storageKey));
        if (missingStorageAsset) throw badRequest("媒体素材引用的 storageKey 不属于本地工作区或不存在");

        db.assets = db.assets.filter((asset) => asset.userId !== userId);
        db.assetFolders = db.assetFolders.filter((folder) => folder.userId !== userId);

        normalizedFolders.forEach((folder) => {
            db.assetFolders.push({
                id: createId("asset_folder"),
                userId,
                localFolderId: folder.id,
                name: folder.name,
                createdAt: folder.createdAt,
                updatedAt: folder.updatedAt,
            });
        });
        normalizedAssets.forEach((asset) => {
            db.assets.push({
                id: createId("asset"),
                userId,
                localAssetId: asset.id,
                storageKey: asset.data.storageKey || "",
                folderId: asset.folderId || null,
                title: asset.title,
                kind: asset.kind,
                assetJson: JSON.stringify(asset),
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
            });
        });

        const nextRevision = currentRevision + 1;
        if (revisionRow) revisionRow.revision = nextRevision;
        else db.assetLibraryRevisions.push({ userId, revision: nextRevision });
        appendAssetChange(db, userId, nextRevision, "snapshot", [{ type: "snapshot_replace", assetCount: normalizedAssets.length, folderCount: normalizedFolders.length }]);
        return { assets: normalizedAssets.length, folders: normalizedFolders.length, revision: nextRevision, savedAt: new Date().toISOString() };
    });
}

export async function applyAssetMutations(userId, operations, expectedRevision = 0) {
    if (!Array.isArray(operations) || !operations.length) throw badRequest("operations 必须是非空数组");
    if (operations.length > 100) throw badRequest("单次素材变更不能超过 100 项");

    return updateDb((db) => {
        const revisionRow = db.assetLibraryRevisions.find((item) => item.userId === userId);
        const currentRevision = Number(revisionRow?.revision || 0);
        if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) throw badRequest("素材库 revision 不合法");
        if (Number(expectedRevision) !== currentRevision) throw conflict("素材库已被其他窗口更新，请重新加载后再保存", { conflict: { currentRevision } });

        const normalizedOperations = [];
        let applied = 0;
        for (const operation of operations) {
            if (!operation || typeof operation !== "object") throw badRequest("素材变更操作不合法");
            const type = String(operation.type || "");
            if (type === "upsert_asset") {
                const asset = normalizeAsset(operation.asset, new Set(db.assetFolders.filter((folder) => folder.userId === userId).map((folder) => folder.localFolderId)));
                assertNoForeignAssetId(db, userId, asset.id);
                assertOwnedStorageKey(db, userId, asset);
                const existing = db.assets.find((item) => item.userId === userId && (item.localAssetId === asset.id || item.id === asset.id));
                const now = new Date().toISOString();
                if (existing) {
                    existing.storageKey = asset.data.storageKey || "";
                    existing.folderId = asset.folderId || null;
                    existing.title = asset.title;
                    existing.kind = asset.kind;
                    existing.assetJson = JSON.stringify(asset);
                    existing.updatedAt = now;
                } else {
                    db.assets.push({
                        id: createId("asset"),
                        userId,
                        localAssetId: asset.id,
                        storageKey: asset.data.storageKey || "",
                        folderId: asset.folderId || null,
                        title: asset.title,
                        kind: asset.kind,
                        assetJson: JSON.stringify(asset),
                        createdAt: asset.createdAt,
                        updatedAt: asset.updatedAt,
                    });
                }
                normalizedOperations.push({ type, asset });
                applied += 1;
                continue;
            }
            if (type === "delete_asset") {
                const id = cleanId(operation.id);
                if (!id) throw badRequest("删除素材缺少合法 id");
                assertNoForeignAssetId(db, userId, id);
                const before = db.assets.length;
                db.assets = db.assets.filter((item) => !(item.userId === userId && (item.localAssetId === id || item.id === id)));
                normalizedOperations.push({ type, id });
                if (db.assets.length !== before) applied += 1;
                continue;
            }
            if (type === "upsert_folder") {
                const folder = normalizeSingleFolder(operation.folder);
                assertNoForeignFolderId(db, userId, folder.id);
                const existing = db.assetFolders.find((item) => item.userId === userId && (item.localFolderId === folder.id || item.id === folder.id));
                const now = new Date().toISOString();
                if (existing) {
                    existing.name = folder.name;
                    existing.updatedAt = now;
                } else {
                    db.assetFolders.push({ id: createId("asset_folder"), userId, localFolderId: folder.id, name: folder.name, createdAt: folder.createdAt, updatedAt: folder.updatedAt });
                }
                normalizedOperations.push({ type, folder });
                applied += 1;
                continue;
            }
            if (type === "delete_folder") {
                const id = cleanId(operation.id);
                if (!id) throw badRequest("删除文件夹缺少合法 id");
                assertNoForeignFolderId(db, userId, id);
                const now = new Date().toISOString();
                const folderBefore = db.assetFolders.length;
                db.assetFolders = db.assetFolders.filter((item) => !(item.userId === userId && (item.localFolderId === id || item.id === id)));
                db.assets
                    .filter((item) => item.userId === userId && item.folderId === id)
                    .forEach((item) => {
                        item.folderId = null;
                        const asset = parseAsset(item.assetJson);
                        if (asset) {
                            asset.folderId = null;
                            asset.updatedAt = now;
                            item.assetJson = JSON.stringify(asset);
                        }
                        item.updatedAt = now;
                    });
                normalizedOperations.push({ type, id });
                if (db.assetFolders.length !== folderBefore) applied += 1;
                continue;
            }
            throw badRequest(`不支持的素材变更操作: ${type}`);
        }

        const serializedOperations = JSON.stringify(normalizedOperations);
        if (serializedOperations.length > 2 * 1024 * 1024) throw payloadTooLarge("素材变更记录超过 2 MB 限制");
        const nextRevision = currentRevision + 1;
        if (revisionRow) revisionRow.revision = nextRevision;
        else db.assetLibraryRevisions.push({ userId, revision: nextRevision });
        appendAssetChange(db, userId, nextRevision, "mutation", normalizedOperations);
        return { applied, revision: nextRevision, savedAt: new Date().toISOString() };
    });
}

function normalizeFolders(folders) {
    const ids = new Set();
    return folders.flatMap((folder) => {
        if (!folder || typeof folder !== "object") return [];
        const id = cleanId(folder.id);
        const name = String(folder.name || "")
            .trim()
            .slice(0, 64);
        if (!id || !name || ids.has(id)) return [];
        ids.add(id);
        const now = new Date().toISOString();
        return [{ id, name, createdAt: validDate(folder.createdAt) || now, updatedAt: validDate(folder.updatedAt) || now }];
    });
}

function normalizeAsset(source, folderIds) {
    if (!source || typeof source !== "object") throw badRequest("素材记录不合法");
    const asset = JSON.parse(JSON.stringify(source));
    const id = cleanId(asset.id);
    const kind = String(asset.kind || "");
    if (!id || !["image", "text", "video", "audio"].includes(kind)) throw badRequest("素材 ID 或类型不合法");
    if (!asset.data || typeof asset.data !== "object") throw badRequest("素材内容不合法");
    if (kind === "image" && !/^image:[A-Za-z0-9_-]+$/.test(String(asset.data.storageKey || ""))) {
        throw badRequest("图片素材缺少已持久化的 storageKey");
    }
    if ((kind === "audio" || kind === "video") && asset.data.storageKey && !new RegExp(`^${kind}:[A-Za-z0-9_-]+$`).test(String(asset.data.storageKey))) {
        throw badRequest(`${kind === "audio" ? "音频" : "视频"}素材 storageKey 不合法`);
    }
    const now = new Date().toISOString();
    asset.id = id;
    asset.kind = kind;
    asset.title =
        String(asset.title || "未命名素材")
            .trim()
            .slice(0, 120) || "未命名素材";
    asset.folderId = asset.folderId && folderIds.has(asset.folderId) ? asset.folderId : null;
    asset.createdAt = validDate(asset.createdAt) || now;
    asset.updatedAt = validDate(asset.updatedAt) || now;
    asset.tags = Array.isArray(asset.tags)
        ? asset.tags
              .map((tag) => String(tag).trim().slice(0, 32))
              .filter(Boolean)
              .slice(0, 20)
        : [];
    if (kind === "image") {
        asset.coverUrl = "";
        asset.data.dataUrl = "";
    }
    return asset;
}

function normalizeSingleFolder(source) {
    const folder = normalizeFolders([source])[0];
    if (!folder) throw badRequest("文件夹记录不合法");
    return folder;
}

function assertOwnedStorageKey(db, userId, asset) {
    if (!asset.data.storageKey || !["image", "audio", "video"].includes(asset.kind)) return;
    const owned = db.storageObjects.some((object) => object.userId === userId && object.storageKey === asset.data.storageKey);
    if (!owned) throw badRequest("媒体素材引用的 storageKey 不属于本地工作区或不存在");
}

function assertNoForeignAssetId(db, userId, id) {
    const record = db.assets.find((item) => item.localAssetId === id || item.id === id);
    if (record && record.userId !== userId) throw forbidden("素材不属于本地工作区");
}

function assertNoForeignFolderId(db, userId, id) {
    const record = db.assetFolders.find((item) => item.localFolderId === id || item.id === id);
    if (record && record.userId !== userId) throw forbidden("文件夹不属于本地工作区");
}

function appendAssetChange(db, userId, revision, source, operations) {
    initializeAssetChangeRepository(db.assetLibraryChanges);
    appendAssetChangeRecord({ id: createId("asset_change"), userId, revision, source, operations, createdAt: new Date().toISOString() });
}

function parseOperations(value) {
    try {
        const operations = JSON.parse(String(value || "[]"));
        return Array.isArray(operations) ? operations : [];
    } catch {
        return [];
    }
}

function parseAsset(value) {
    try {
        const asset = JSON.parse(String(value || ""));
        return asset && typeof asset === "object" ? asset : null;
    } catch {
        return null;
    }
}

function cleanId(value) {
    const id = String(value || "").trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : "";
}

function validDate(value) {
    const date = String(value || "");
    return Number.isFinite(Date.parse(date)) ? date : "";
}

function timestamp(value) {
    return Date.parse(String(value || "")) || 0;
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

function forbidden(message) {
    const error = new Error(message);
    error.statusCode = 403;
    return error;
}
