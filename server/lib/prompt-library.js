import { createId, readDb, updateDb } from "./store.js";
import { getStorageObject } from "./storage-objects.js";

const SOURCE_TYPES = new Set(["image-workbench", "canvas"]);
const STORAGE_KEY_PATTERN = /^image:[A-Za-z0-9_-]+$/;

export async function listPromptLibrary(user, query = {}) {
    const scope = normalizeScope(query.scope);
    const folder = String(query.folder || "all");
    const keyword = String(query.keyword || "")
        .trim()
        .toLowerCase()
        .slice(0, 100);
    const limit = clampInteger(query.limit, 1, 100, 50);
    const db = await readDb();
    const visibleFolders = db.promptLibraryFolders.filter((item) => canReadScoped(item, user, scope));
    const visibleFolderIds = new Set(visibleFolders.map((item) => item.id));
    let items = db.promptLibraryItems.filter((item) => canReadScoped(item, user, scope));

    if (folder === "unfiled") items = items.filter((item) => !item.folderId);
    else if (folder !== "all") {
        if (!visibleFolderIds.has(folder)) throw notFound("文件夹不存在");
        items = items.filter((item) => item.folderId === folder);
    }
    if (keyword) {
        items = items.filter((item) => [item.title, item.prompt, item.ownerDisplayName, ...(item.tags || [])].join(" ").toLowerCase().includes(keyword));
    }
    items.sort(compareUpdatedDesc);
    const total = items.length;
    const cursor = parseCursor(query.cursor);
    if (cursor) items = items.filter((item) => compareCursor(item, cursor) > 0);
    const page = items.slice(0, limit);
    const nextCursor = items.length > limit && page.length ? encodeCursor(page[page.length - 1]) : null;
    const scopeItems = db.promptLibraryItems.filter((item) => canReadScoped(item, user, scope));

    return {
        items: page.map((item) => publicItem(item, user)),
        folders: visibleFolders.sort(compareCreatedAsc).map((folderItem) => publicFolder(folderItem, user, scopeItems)),
        nextCursor,
        total,
    };
}

export async function createPromptLibraryItem(user, input = {}) {
    const scope = normalizeScope(input.scope);
    const prompt = normalizePrompt(input.prompt);
    const title = normalizeTitle(input.title, prompt);
    const tags = normalizeTags(input.tags);
    const storageKey = normalizeStorageKey(input.imageStorageKey);
    const sourceType = normalizeSourceType(input.sourceType);
    const sourceRefId = String(input.sourceRefId || "")
        .trim()
        .slice(0, 160);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

    return updateDb((db) => {
        const duplicate = db.promptLibraryItems.find((item) => item.ownerUserId === user.id && item.idempotencyKey === idempotencyKey);
        if (duplicate) return publicItem(duplicate, user);
        const storage = db.storageObjects.find((item) => item.userId === user.id && item.storageKey === storageKey);
        if (!storage) throw forbidden("图片不属于本地工作区或不存在");
        const folderId = validateTargetFolder(db, user, scope, input.folderId);
        const now = new Date().toISOString();
        const item = {
            id: createId("prompt_item"),
            scope,
            ownerUserId: user.id,
            ownerDisplayName: user.displayName || user.username || "",
            folderId,
            title,
            prompt,
            tags,
            imageStorageKey: storageKey,
            imageMimeType: storage.mimeType || "image/png",
            imageWidth: clampInteger(input.imageWidth, 0, 100000, 0),
            imageHeight: clampInteger(input.imageHeight, 0, 100000, 0),
            imageBytes: Number(storage.bytes || 0),
            sourceType,
            sourceRefId,
            idempotencyKey,
            createdAt: now,
            updatedAt: now,
        };
        db.promptLibraryItems.push(item);
        audit("create", user, item);
        return publicItem(item, user);
    });
}

export async function updatePromptLibraryItem(user, itemId, input = {}) {
    return updateDb((db) => {
        const item = requireItem(db, itemId);
        requireManage(item, user);
        if (Object.hasOwn(input, "title")) item.title = normalizeTitle(input.title, item.prompt);
        if (Object.hasOwn(input, "prompt")) item.prompt = normalizePrompt(input.prompt);
        if (Object.hasOwn(input, "tags")) item.tags = normalizeTags(input.tags);
        if (Object.hasOwn(input, "folderId")) item.folderId = validateTargetFolder(db, user, item.scope, input.folderId);
        item.updatedAt = new Date().toISOString();
        audit("update", user, item);
        return publicItem(item, user);
    });
}

export async function deletePromptLibraryItem(user, itemId) {
    return updateDb((db) => {
        const item = requireItem(db, itemId);
        requireManage(item, user);
        db.promptLibraryItems = db.promptLibraryItems.filter((candidate) => candidate.id !== item.id);
        audit("delete", user, item);
        return { ok: true, id: item.id };
    });
}

export async function copyPromptLibraryItem(user, itemId, input = {}) {
    const sourceDb = await readDb();
    const source = requireItem(sourceDb, itemId);
    if (source.ownerUserId !== user.id) throw forbidden("只能复制自己创建的提示词记录");
    const scope = normalizeScope(input.scope);
    const folderId = input.folderId || null;
    return createPromptLibraryItem(user, {
        scope,
        folderId,
        title: source.title,
        prompt: source.prompt,
        tags: source.tags,
        imageStorageKey: source.imageStorageKey,
        imageWidth: source.imageWidth,
        imageHeight: source.imageHeight,
        sourceType: source.sourceType,
        sourceRefId: source.sourceRefId,
        idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    });
}

export async function createPromptLibraryFolder(user, input = {}) {
    const scope = normalizeScope(input.scope);
    const name = normalizeFolderName(input.name);
    return updateDb((db) => {
        assertFolderNameAvailable(db, user, scope, name);
        const now = new Date().toISOString();
        const folder = { id: createId("prompt_folder"), scope, ownerUserId: user.id, name, createdAt: now, updatedAt: now };
        db.promptLibraryFolders.push(folder);
        audit("create-folder", user, folder);
        return publicFolder(folder, user, db.promptLibraryItems);
    });
}

export async function updatePromptLibraryFolder(user, folderId, input = {}) {
    const name = normalizeFolderName(input.name);
    return updateDb((db) => {
        const folder = requireFolder(db, folderId);
        requireManage(folder, user);
        assertFolderNameAvailable(db, user, folder.scope, name, folder.id);
        folder.name = name;
        folder.updatedAt = new Date().toISOString();
        audit("update-folder", user, folder);
        return publicFolder(folder, user, db.promptLibraryItems);
    });
}

export async function deletePromptLibraryFolder(user, folderId) {
    return updateDb((db) => {
        const folder = requireFolder(db, folderId);
        requireManage(folder, user);
        db.promptLibraryFolders = db.promptLibraryFolders.filter((candidate) => candidate.id !== folder.id);
        const now = new Date().toISOString();
        let moved = 0;
        db.promptLibraryItems.forEach((item) => {
            if (item.folderId !== folder.id || item.scope !== folder.scope) return;
            item.folderId = null;
            item.updatedAt = now;
            moved += 1;
        });
        audit("delete-folder", user, folder);
        return { ok: true, id: folder.id, moved };
    });
}

export async function getPromptLibraryImage(user, itemId) {
    const db = await readDb();
    const item = requireItem(db, itemId);
    if (!canRead(item, user)) throw notFound("提示词记录不存在");
    return getStorageObject(item.ownerUserId, item.imageStorageKey);
}

function publicItem(item, user) {
    return {
        id: item.id,
        scope: item.scope,
        ownerUserId: item.ownerUserId,
        ownerDisplayName: item.ownerDisplayName || "",
        folderId: item.folderId || null,
        title: item.title,
        prompt: item.prompt,
        tags: Array.isArray(item.tags) ? item.tags : [],
        imageUrl: `/api/prompt-library/items/${encodeURIComponent(item.id)}/image`,
        imageMimeType: item.imageMimeType || "image/png",
        imageWidth: Number(item.imageWidth || 0),
        imageHeight: Number(item.imageHeight || 0),
        imageBytes: Number(item.imageBytes || 0),
        sourceType: item.sourceType,
        sourceRefId: item.sourceRefId || "",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        canManage: canManage(item, user),
    };
}

function publicFolder(folder, user, items) {
    return {
        id: folder.id,
        scope: folder.scope,
        ownerUserId: folder.ownerUserId,
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        canManage: canManage(folder, user),
        count: items.filter((item) => item.folderId === folder.id && item.ownerUserId === user.id).length,
    };
}

function canReadScoped(record, user, scope) {
    return record.scope === scope && record.ownerUserId === user.id;
}

function canRead(record, user) {
    return record.ownerUserId === user.id;
}

function canManage(record, user) {
    return record.ownerUserId === user.id;
}

function requireManage(record, user) {
    if (!canManage(record, user)) throw forbidden("无权管理该提示词记录或文件夹");
}

function validateTargetFolder(db, user, scope, value) {
    const id = String(value || "").trim();
    if (!id || id === "unfiled") return null;
    const folder = db.promptLibraryFolders.find((item) => item.id === id && item.scope === scope && item.ownerUserId === user.id);
    if (!folder) throw badRequest("目标文件夹不存在");
    return folder.id;
}

function assertFolderNameAvailable(db, user, scope, name, excludeId = "") {
    const normalized = name.toLocaleLowerCase();
    const duplicate = db.promptLibraryFolders.find((item) => item.id !== excludeId && item.scope === scope && item.ownerUserId === user.id && item.name.toLocaleLowerCase() === normalized);
    if (duplicate) throw conflict("已存在同名文件夹");
}

function requireItem(db, itemId) {
    const item = db.promptLibraryItems.find((candidate) => candidate.id === String(itemId || ""));
    if (!item) throw notFound("提示词记录不存在");
    return item;
}

function requireFolder(db, folderId) {
    const folder = db.promptLibraryFolders.find((candidate) => candidate.id === String(folderId || ""));
    if (!folder) throw notFound("文件夹不存在");
    return folder;
}

function normalizeScope(value) {
    if (value && String(value).trim() !== "personal") throw badRequest("本地版只支持 personal 作用域");
    return "personal";
}

function normalizePrompt(value) {
    const prompt = String(value || "").trim();
    if (!prompt) throw badRequest("提示词不能为空");
    if (prompt.length > 8000) throw tooLarge("提示词不能超过 8000 个字符");
    return prompt;
}

function normalizeTitle(value, prompt) {
    const title = String(value || "").trim() || Array.from(prompt).slice(0, 24).join("");
    if (title.length > 120) throw badRequest("标题不能超过 120 个字符");
    return title;
}

function normalizeTags(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((tag) => String(tag || "").trim()).filter(Boolean)))
        .slice(0, 20)
        .map((tag) => tag.slice(0, 32));
}

function normalizeStorageKey(value) {
    const storageKey = String(value || "").trim();
    if (!STORAGE_KEY_PATTERN.test(storageKey)) throw badRequest("imageStorageKey 不合法");
    return storageKey;
}

function normalizeSourceType(value) {
    const sourceType = String(value || "image-workbench").trim();
    if (!SOURCE_TYPES.has(sourceType)) throw badRequest("sourceType 不合法");
    return sourceType;
}

function normalizeIdempotencyKey(value) {
    const key = String(value || "").trim();
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw badRequest("idempotencyKey 不合法");
    return key;
}

function normalizeFolderName(value) {
    const name = String(value || "").trim();
    if (!name) throw badRequest("文件夹名称不能为空");
    if (name.length > 64) throw badRequest("文件夹名称不能超过 64 个字符");
    return name;
}

function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(number)));
}

function compareUpdatedDesc(a, b) {
    return String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id));
}

function compareCreatedAsc(a, b) {
    return String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id));
}

function compareCursor(item, cursor) {
    if (item.updatedAt < cursor.updatedAt) return 1;
    if (item.updatedAt > cursor.updatedAt) return -1;
    return item.id < cursor.id ? 1 : -1;
}

function encodeCursor(item) {
    return Buffer.from(JSON.stringify({ updatedAt: item.updatedAt, id: item.id })).toString("base64url");
}

function parseCursor(value) {
    if (!value) return null;
    try {
        const cursor = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
        return cursor?.updatedAt && cursor?.id ? cursor : null;
    } catch {
        throw badRequest("cursor 不合法");
    }
}

function audit(action, user, record) {
    console.info("prompt-library", { action, workspaceId: user.id, recordId: record.id, at: new Date().toISOString() });
}

function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function badRequest(message) {
    return httpError(400, message);
}

function forbidden(message) {
    return httpError(403, message);
}

function notFound(message) {
    return httpError(404, message);
}

function conflict(message) {
    return httpError(409, message);
}

function tooLarge(message) {
    return httpError(413, message);
}
