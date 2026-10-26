export type ApiCapability = "image" | "text" | "video" | "audio" | "music" | "tinify";

export type LocalApiConfig = {
    id?: string;
    channels?: LocalApiConfig[];
    textProtocol?: "chat" | "responses";
    capability: ApiCapability;
    configured: boolean;
    name: string;
    baseUrl: string;
    apiFormat: "openai" | "gemini";
    apiKeyFingerprint: string;
    models: string[];
    availableModels: string[];
    modelsStatus: "ready" | "error" | "unverified" | "not_required";
    modelsError: string;
    modelsFetchedAt: string;
    updatedAt: string;
};

export type LocalApiSettings = Record<ApiCapability, LocalApiConfig>;

export async function fetchLocalApiSettings() {
    const data = await requestJson<{ apis: LocalApiSettings }>("/api/settings/apis");
    return data.apis;
}

export async function updateLocalApiSetting(
    capability: ApiCapability,
    input: { channelId?: string; create?: boolean; name?: string; textProtocol?: "chat" | "responses"; baseUrl?: string; apiKey?: string; apiFormat?: "openai" | "gemini"; selectedModels?: string[]; clear?: boolean },
) {
    const data = await requestJson<{ config: LocalApiConfig }>(`/api/settings/apis/${capability}`, {
        method: "PUT",
        body: JSON.stringify(input),
    });
    return data.config;
}

export async function refreshLocalApiModels(capability: ApiCapability, channelId?: string) {
    const data = await requestJson<{ config: LocalApiConfig }>(`/api/settings/apis/${capability}/models/refresh${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ""}`, { method: "POST" });
    return data.config;
}

async function requestJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
        ...init,
    }).catch(() => {
        throw new Error("本地服务未启动，请重新打开应用。");
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
}
