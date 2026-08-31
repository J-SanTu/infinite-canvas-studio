import { nanoid } from "nanoid";

import { APP_CACHE_ROOT } from "@/config/app-config";

export type CanvasCacheMetadata = {
    cacheKey: string;
    cachePath: string;
    ip: string;
    date: string;
};

export function buildCanvasImageCacheMetadata(mimeType: string): CanvasCacheMetadata {
    const date = new Date().toISOString().slice(0, 10);
    const ip = clientCacheIp();
    const ext = extensionFromMimeType(mimeType);
    const id = nanoid();
    return {
        cacheKey: `${ip}/${date}/${id}.${ext}`,
        cachePath: `${APP_CACHE_ROOT}/${ip}/${date}/${id}.${ext}`,
        ip,
        date,
    };
}

function clientCacheIp() {
    if (typeof window === "undefined") return "unknown-ip";
    const configured = window.localStorage.getItem("santu-canvas:cache-ip")?.trim();
    return sanitizePathPart(configured || "local-browser");
}

function sanitizePathPart(value: string) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, "_") || "unknown";
}

function extensionFromMimeType(mimeType: string) {
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    return "png";
}

