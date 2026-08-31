export type ApiCapability = "image" | "text" | "video" | "audio" | "music";

export type LocalApiConfig = {
    capability: ApiCapability;
    configured: boolean;
    name: string;
    baseUrl: string;
    apiFormat: "openai" | "gemini";
    apiKeyFingerprint: string;
    models: string[];
    updatedAt: string;
};

export type LocalApiSettings = Record<ApiCapability, LocalApiConfig>;

export async function fetchLocalApiSettings() {
    const data = await requestJson<{ apis: LocalApiSettings }>("/api/settings/apis");
    return data.apis;
}

export async function updateLocalApiSetting(capability: ApiCapability, input: { baseUrl?: string; apiKey?: string; apiFormat?: "openai" | "gemini"; models?: string[]; clear?: boolean }) {
    const data = await requestJson<{ config: LocalApiConfig }>(`/api/settings/apis/${capability}`, {
        method: "PUT",
        body: JSON.stringify(input),
    });
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
