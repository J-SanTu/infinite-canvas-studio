import type { ImageQuickToolsConfig } from "@/components/canvas/canvas-image-toolbar-tools";

type UiPreferences = { imageToolbar?: Partial<ImageQuickToolsConfig> };

export async function fetchUiPreferences() {
    const data = await requestJson<{ preferences: UiPreferences }>("/api/settings/preferences");
    return data.preferences;
}

export async function saveUiPreferences(preferences: UiPreferences) {
    const data = await requestJson<{ preferences: UiPreferences }>("/api/settings/preferences", {
        method: "PUT",
        body: JSON.stringify(preferences),
    });
    return data.preferences;
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
