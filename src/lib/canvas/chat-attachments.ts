import { nanoid } from "nanoid";
import { uploadImage, setImageBlob, ensureImageDurable, imageToDataUrl, type UploadedImage } from "@/services/image-storage";
import type { ChatReference } from "./canvas-chat";

export type ChatAsset = { id: string; name: string; image: UploadedImage; svg?: { storageKey: string; colors: string[] } };
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function inspectSvg(source: string) {
    if (source.length > 2_000_000) throw new Error("SVG 文件过大，请使用小于 2 MB 的文件。");
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("SVG 含不支持的文档声明，请导出为独立 SVG。");
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") throw new Error("SVG 格式不完整，请重新复制完整 SVG。");
    const unsafeCss = (value: string) =>
        /@import|javascript:/i.test(value) ||
        [...value.matchAll(/url\(([^)]*)\)/gi)].some(
            (match) =>
                !match[1]
                    .trim()
                    .replace(/^['"]|['"]$/g, "")
                    .startsWith("#"),
        );
    for (const element of [doc.documentElement, ...doc.documentElement.querySelectorAll("*")]) {
        if (["script", "foreignobject", "iframe", "object", "embed", "animate", "animatetransform", "set"].includes(element.localName.toLowerCase())) throw new Error("请使用不含脚本或动画的静态 SVG。");
        for (const attr of Array.from(element.attributes)) {
            if (/^on/i.test(attr.name) || (attr.localName === "href" && !attr.value.startsWith("#")) || unsafeCss(attr.value)) throw new Error("SVG 含外部资源或脚本，请导出为独立静态 SVG。");
        }
        if (element.localName === "style" && unsafeCss(element.textContent || "")) throw new Error("SVG 样式引用了外部资源。");
    }
    const svg = doc.documentElement;
    const box = (svg.getAttribute("viewBox") || "").trim().split(/[ ,]+/).map(Number);
    const dimension = (value: string | null, fallback: number) => (value && !/%|em|rem|vw|vh/i.test(value) ? parseFloat(value) || fallback : fallback);
    const width = dimension(svg.getAttribute("width"), box.length === 4 ? box[2] : 0);
    const height = dimension(svg.getAttribute("height"), box.length === 4 ? box[3] : 0);
    if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error("SVG 需要有效的 width/height 或 viewBox。");
    if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const clean = new XMLSerializer().serializeToString(svg);
    const colors = [...new Set((clean.match(/#[\da-f]{6}\b|#[\da-f]{3}\b/gi) || []).map((color) => color.toUpperCase()))].slice(0, 24);
    return { source: clean, width, height, colors };
}

async function imageElement(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("无法读取图片，请重新上传。"));
        image.src = url;
    });
}
async function rasterBlob(url: string, maxSide = 2048) {
    const image = await imageElement(url);
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法生成素材预览。");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("素材转换失败。"))), "image/png"));
}
export async function prepareChatAsset(file: File): Promise<ChatAsset> {
    if (file.size > MAX_FILE_BYTES) throw new Error("单张图片不能超过 20 MB。");
    if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
        const source = await file.text();
        const svg = inspectSvg(source);
        const originalStorageKey = `image:${nanoid()}`;
        await setImageBlob(originalStorageKey, file);
        const previewUrl = URL.createObjectURL(new Blob([svg.source], { type: "image/svg+xml" }));
        try {
            const image = await uploadImage(await rasterBlob(previewUrl));
            await Promise.all([ensureImageDurable(originalStorageKey), ensureImageDurable(image.storageKey)]);
            return { id: `chat-asset-${nanoid()}`, name: file.name || "Logo.svg", image, svg: { storageKey: originalStorageKey, colors: svg.colors } };
        } finally {
            URL.revokeObjectURL(previewUrl);
        }
    }
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error("支持 PNG、JPG、WebP、GIF 和 SVG 图片。");
    const image = await uploadImage(file);
    await ensureImageDurable(image.storageKey);
    return { id: `chat-asset-${nanoid()}`, name: file.name || "粘贴图片.png", image };
}

export async function chatVisionImages(references: ChatReference[]) {
    const images = references.filter((ref) => ref.type === "image");
    if (images.length > 12) throw new Error("一次最多引用 12 张图片，请减少引用。");
    return Promise.all(
        images.map(async (ref) => {
            const url = await imageToDataUrl({ storageKey: ref.storageKey, dataUrl: ref.dataUrl });
            if (!url) throw new Error(`素材「${ref.title}」已丢失，请重新上传。`);
            const blob = await rasterBlob(url, 1536);
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("读取图片失败。"));
                reader.readAsDataURL(blob);
            });
            return { id: ref.id, dataUrl };
        }),
    );
}
