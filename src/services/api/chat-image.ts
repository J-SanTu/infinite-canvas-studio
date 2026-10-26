import { chatVisionImages } from "@/lib/canvas/chat-attachments";
import { requestEdit, requestGeneration } from "./image";
import { uploadImage, ensureImageDurable } from "@/services/image-storage";
import { resizeDataUrlToExactSize } from "@/lib/canvas/canvas-image-data";
import type { AiConfig } from "@/stores/use-config-store";
import type { ChatReference } from "@/lib/canvas/canvas-chat";

export function chatImageDimensions(ratio: string) {
    let [w, h] = ratio.split(":").map(Number);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisor = gcd(w, h);
    w /= divisor;
    h /= divisor;
    const unit = Math.max(16, Math.floor(1024 / Math.min(w, h) / 16) * 16);
    return { width: w * unit, height: h * unit };
}
export async function generateChatImage(config: AiConfig, prompt: string, ratio: string, references: ChatReference[], signal: AbortSignal) {
    const dimensions = chatImageDimensions(ratio);
    const imageConfig = { ...config, size: `${dimensions.width}x${dimensions.height}`, count: "1" };
    const images = await Promise.all(
        references
            .filter((ref) => ref.type === "image")
            .map(async (ref) => {
                if (ref.mimeType === "image/svg+xml") {
                    const [preview] = await chatVisionImages([ref]);
                    return { id: ref.id, name: `${ref.title}.png`, type: "image/png", dataUrl: preview.dataUrl };
                }
                return { id: ref.id, name: ref.title, type: ref.mimeType || "image/png", dataUrl: ref.dataUrl || "", storageKey: ref.storageKey };
            }),
    );
    signal.throwIfAborted();
    const response = images.length ? await requestEdit(imageConfig, prompt, images, undefined, { signal, preserveNativeSize: true }) : await requestGeneration(imageConfig, prompt, { signal, preserveNativeSize: true });
    signal.throwIfAborted();
    if (!response[0]?.dataUrl) throw new Error("图片模型没有返回图片，请重试。");
    const exact = await resizeDataUrlToExactSize(response[0].dataUrl, dimensions);
    signal.throwIfAborted();
    const uploaded = await uploadImage(exact);
    await ensureImageDurable(uploaded.storageKey);
    signal.throwIfAborted();
    return uploaded;
}
