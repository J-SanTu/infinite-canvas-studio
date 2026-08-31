import { imageToDataUrl } from "@/services/image-storage";

export type DirectorCanvasReference = {
    nodeId: string;
    kind: "image" | "text" | "video" | "audio";
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

const DIRECTOR_REFERENCE_MAX_CHARS = 900_000;
const DIRECTOR_PROJECT_MAX_CHARS = 2 * 1024 * 1024;
const REFERENCE_NAME_PREFIX = "画布引用 · ";

export async function prepareDirectorPrimaryReference(references: DirectorCanvasReference[]) {
    const reference = references.find((item) => item.kind === "image" && (item.dataUrl || item.storageKey));
    if (!reference) return null;
    const dataUrl = await imageToDataUrl({ dataUrl: reference.dataUrl, storageKey: reference.storageKey });
    if (!dataUrl?.startsWith("data:image/")) throw new Error("导演台无法读取上游参考图");
    return { ...reference, dataUrl: await fitReferenceDataUrl(dataUrl) };
}

export function mergeDirectorPrimaryReference(projectJson: string, reference: DirectorCanvasReference | null) {
    if (!projectJson || !reference?.dataUrl) return projectJson;
    const parsed = JSON.parse(projectJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("导演工程 JSON 不合法");

    const nextReference = {
        image: reference.dataUrl,
        name: `${REFERENCE_NAME_PREFIX}${reference.title}`.slice(0, 80),
        opacity: 0.45,
        scale: 1,
        x: 0,
        y: 0,
        visible: true,
        includeInExport: false,
    };
    const shots = Array.isArray(parsed.shots) ? parsed.shots : [];
    const activeShotId = typeof parsed.activeShotId === "string" ? parsed.activeShotId : "";
    const activeIndex = Math.max(0, shots.findIndex((shot) => isRecord(shot) && shot.id === activeShotId));
    const nextShots = shots.map((shot, index) => (index === activeIndex && isRecord(shot) ? { ...shot, reference: nextReference } : shot));
    const merged = JSON.stringify({ ...parsed, reference: nextReference, ...(nextShots.length ? { shots: nextShots } : {}) });
    if (merged.length > DIRECTOR_PROJECT_MAX_CHARS) throw new Error("加入上游参考图后导演工程超过 2 MB 限制");
    return merged;
}

async function fitReferenceDataUrl(dataUrl: string) {
    if (dataUrl.length <= DIRECTOR_REFERENCE_MAX_CHARS) return dataUrl;
    const image = await loadImage(dataUrl);
    let maxEdge = 1600;
    let quality = 0.84;
    let candidate = dataUrl;

    for (let attempt = 0; attempt < 7; attempt += 1) {
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
        const context = canvas.getContext("2d");
        if (!context) break;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        candidate = canvas.toDataURL("image/webp", quality);
        if (candidate.length <= DIRECTOR_REFERENCE_MAX_CHARS) return candidate;
        maxEdge = Math.max(480, Math.round(maxEdge * 0.76));
        quality = Math.max(0.56, quality - 0.06);
    }

    if (candidate.length > DIRECTOR_REFERENCE_MAX_CHARS) throw new Error("上游参考图压缩后仍超过导演工程限制");
    return candidate;
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("导演台无法解析上游参考图"));
        image.src = src;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
