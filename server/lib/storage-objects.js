import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readDb, updateDb } from "./store.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const storageRoot = process.env.CANVAS_STORAGE_PATH ? resolve(process.env.CANVAS_STORAGE_PATH) : resolve(serverDir, "data/storage");
const allowedStorageKeyPattern = /^(image|video|audio):[A-Za-z0-9_-]+$/;

export async function putStorageObject(userId, storageKey, buffer, mimeType, cacheKey) {
    assertStorageKey(storageKey);
    if (!buffer?.length) throw badRequest("文件内容不能为空");
    const safeMimeType = normalizeMediaMimeType(mimeType, storageKey);
    const path = objectPath(userId, storageKey, safeMimeType, cacheKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);

    return updateDb((db) => {
        const now = new Date().toISOString();
        const existing = db.storageObjects.find((item) => item.userId === userId && item.storageKey === storageKey);
        const row = existing || {
            id: `storage_${storageKey.replace(/^[^:]+:/, "")}`,
            userId,
            storageKey,
            createdAt: now,
        };
        row.mimeType = safeMimeType;
        row.bytes = buffer.length;
        row.path = path;
        row.updatedAt = now;
        if (!existing) db.storageObjects.push(row);
        return { storageKey, bytes: row.bytes, mimeType: row.mimeType };
    });
}

export async function getStorageObject(userId, storageKey) {
    assertStorageKey(storageKey);
    const db = await readDb();
    const row = db.storageObjects.find((item) => item.userId === userId && item.storageKey === storageKey) || null;
    if (!row?.path) throw notFound();
    try {
        const buffer = await readFile(row.path);
        return { buffer, mimeType: row.mimeType || "image/png", bytes: buffer.length };
    } catch {
        throw notFound();
    }
}

function objectPath(userId, storageKey, mimeType, cacheKey) {
    const extension = mimeExtension(mimeType);
    const safeCacheKey = normalizeCacheKey(cacheKey);
    if (safeCacheKey) return resolve(storageRoot, safeCacheKey);
    return resolve(storageRoot, safePathPart(userId), `${safePathPart(storageKey)}.${extension}`);
}

function assertStorageKey(storageKey) {
    if (!allowedStorageKeyPattern.test(String(storageKey || ""))) throw badRequest("storageKey 不合法");
}

function safePathPart(value) {
    return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function normalizeCacheKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parts = raw.split("/");
    if (parts.length !== 3) return "";
    const [ip, date, fileName] = parts;
    if (!/^[A-Za-z0-9_.-]+$/.test(ip)) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    if (!/^[A-Za-z0-9_-]+\.(png|jpg|webp|gif|mp4|webm|mov|mp3|wav|ogg|opus|aac|flac|pcm)$/.test(fileName)) return "";
    return `${ip}/${date}/${fileName}`;
}

function normalizeMediaMimeType(value, storageKey) {
    const mimeType = String(value || "image/png").toLowerCase().split(";")[0].trim();
    const prefix = String(storageKey || "").split(":", 1)[0];
    const allowed = prefix === "audio" ? ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/opus", "audio/aac", "audio/flac", "audio/pcm"] : prefix === "video" ? ["video/mp4", "video/webm", "video/quicktime"] : ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (allowed.includes(mimeType)) return mimeType;
    return allowed[0];
}

function mimeExtension(mimeType) {
    const extension = extname(`file.${mimeType.split("/")[1] || "png"}`).slice(1);
    if (extension === "jpeg") return "jpg";
    if (["png", "jpg", "webp", "gif", "mp4", "webm", "quicktime", "mpeg", "mp3", "wav", "ogg", "opus", "aac", "flac", "pcm"].includes(extension)) return extension === "quicktime" ? "mov" : extension;
    return "bin";
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function notFound() {
    const error = new Error("文件不存在");
    error.statusCode = 404;
    return error;
}
