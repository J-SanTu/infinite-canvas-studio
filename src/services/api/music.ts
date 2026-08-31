import axios from "axios";

import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

export async function requestMusicGeneration(config: AiConfig, prompt: string, options: { model?: string; durationMs?: number; outputFormat?: string; signal?: AbortSignal } = {}): Promise<Blob> {
    const text = prompt.trim();
    if (!text) throw new Error("请输入音乐提示词");
    if (!config.baseUrl.trim() || !config.apiKey.trim()) throw new Error("请先配置音乐 API 的 Base URL 和 API Key");
    const model = options.model || "music_v2";
    const durationMs = options.durationMs === undefined ? undefined : Math.max(3000, Math.min(600000, Math.floor(options.durationMs)));
    const outputFormat = options.outputFormat || "mp3_44100_128";
    try {
        const response = await axios.post<Blob>(
            `${buildApiUrl(config.baseUrl, "/music")}?output_format=${encodeURIComponent(outputFormat)}`,
            { prompt: text, model_id: model, ...(durationMs ? { music_length_ms: durationMs } : {}) },
            { headers: { Authorization: `Bearer ${config.apiKey}`, "x-canvas-capability": "music", "Content-Type": "application/json" }, responseType: "blob", signal: options.signal },
        );
        await assertMusicBlob(response.data);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: "audio/mpeg" });
    } catch (error) {
        throw new Error(readAxiosError(error));
    }
}

export function storeGeneratedMusic(blob: Blob): Promise<UploadedFile> {
    return uploadMediaFile(blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" }), "audio");
}

async function assertMusicBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    try {
        const payload = JSON.parse(await blob.text()) as { detail?: { message?: string }; message?: string; error?: string };
        throw new Error(payload.detail?.message || payload.message || payload.error || "音乐生成失败");
    } catch (error) {
        if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
    }
}

function readAxiosError(error: unknown) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) return "音乐 API 鉴权失败，请检查 Key 或套餐权限";
        if (status === 429) return "音乐 API 被限流或额度不足，请稍后重试";
        if (status === 422) return "音乐提示词或参数不符合 ElevenLabs Music API 要求";
        return status ? `音乐生成失败（${status}）` : "音乐 API 连接失败";
    }
    return error instanceof Error ? error.message : "音乐生成失败";
}
