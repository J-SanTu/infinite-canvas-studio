import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { buildCanvasImageCacheMetadata } from "@/lib/cache/canvas-cache";

export type UploadedImage = {
    url: string;
    storageKey: string;
    cacheKey?: string;
    cachePath?: string;
    ip?: string;
    date?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const uploadQueueStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_upload_queue" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `image:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    const meta = await readImageMeta(url);
    const mimeType = blob.type || meta.mimeType;
    const cache = buildCanvasImageCacheMetadata(mimeType);
    await store.setItem(storageKey, blob);
    await uploadQueueStore.setItem(storageKey, { cacheKey: cache.cacheKey, mimeType });
    void ensureImageDurable(storageKey).catch(() => undefined);
    objectUrls.set(storageKey, url);
    return { url, storageKey, ...cache, width: meta.width, height: meta.height, bytes: blob.size, mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return restoreImageBlob(storageKey, fallback);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    const mimeType = blob.type || "image/png";
    const cache = buildCanvasImageCacheMetadata(mimeType);
    await store.setItem(storageKey, blob);
    await uploadQueueStore.setItem(storageKey, { cacheKey: cache.cacheKey, mimeType });
    void ensureImageDurable(storageKey).catch(() => undefined);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
            await uploadQueueStore.removeItem(key);
        }),
    );
}

export async function ensureImageDurable(storageKey: string) {
    const queued = await uploadQueueStore.getItem<{ cacheKey?: string; mimeType?: string }>(storageKey);
    if (!queued) return;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) throw new Error("图片本地缓存不存在，请重新上传或生成");
    await mirrorImageBlob(storageKey, blob, queued.cacheKey || buildCanvasImageCacheMetadata(queued.mimeType || blob.type || "image/png").cacheKey);
    await uploadQueueStore.removeItem(storageKey);
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function mirrorImageBlob(storageKey: string, blob: Blob, cacheKey: string) {
    try {
        const response = await fetch(`/api/storage/images/${encodeURIComponent(storageKey)}`, {
            method: "PUT",
            headers: { "Content-Type": blob.type || "image/png", "X-Canvas-Cache-Key": cacheKey },
            body: blob,
        });
        if (!response.ok) {
            const errorText = await readStorageError(response);
            throw new Error(errorText || `HTTP ${response.status}`);
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        throw new Error(`图片本地缓存写入失败${detail ? `：${detail}` : ""}。请确认本地服务正在运行。`);
    }
}

async function restoreImageBlob(storageKey: string, fallback: string) {
    try {
        const response = await fetch(`/api/storage/images/${encodeURIComponent(storageKey)}`);
        if (!response.ok) return fallback;
        const blob = await response.blob();
        if (!blob.size) return fallback;
        await store.setItem(storageKey, blob);
        const url = URL.createObjectURL(blob);
        objectUrls.set(storageKey, url);
        return url;
    } catch {
        return fallback;
    }
}

async function readStorageError(response: Response) {
    try {
        const data = (await response.json()) as { error?: string };
        return data.error || "";
    } catch {
        return "";
    }
}
