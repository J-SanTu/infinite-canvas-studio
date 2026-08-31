import type { CreatePromptLibraryItemInput, PromptLibraryFolder, PromptLibraryItem, PromptLibraryListResponse, PromptLibraryScope } from "@/types/prompt-library";

export async function listPromptLibrary({ scope, folder = "all", keyword = "", cursor = "", limit = 50 }: { scope: PromptLibraryScope; folder?: string; keyword?: string; cursor?: string; limit?: number }) {
    const url = new URL("/api/prompt-library", window.location.origin);
    url.searchParams.set("scope", scope);
    url.searchParams.set("folder", folder);
    if (keyword.trim()) url.searchParams.set("keyword", keyword.trim());
    if (cursor) url.searchParams.set("cursor", cursor);
    url.searchParams.set("limit", String(limit));
    return request<PromptLibraryListResponse>(`${url.pathname}${url.search}`);
}

export function createPromptLibraryItem(input: CreatePromptLibraryItemInput) {
    return request<PromptLibraryItem>("/api/prompt-library/items", { method: "POST", body: JSON.stringify(input) });
}

export function updatePromptLibraryItem(itemId: string, input: Partial<Pick<PromptLibraryItem, "title" | "prompt" | "tags" | "folderId">>) {
    return request<PromptLibraryItem>(`/api/prompt-library/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deletePromptLibraryItem(itemId: string) {
    return request<{ ok: true; id: string }>(`/api/prompt-library/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

export function copyPromptLibraryItem(itemId: string, input: { scope: PromptLibraryScope; folderId: string | null; idempotencyKey: string }) {
    return request<PromptLibraryItem>(`/api/prompt-library/items/${encodeURIComponent(itemId)}/copy`, { method: "POST", body: JSON.stringify(input) });
}

export function createPromptLibraryFolder(input: { scope: PromptLibraryScope; name: string }) {
    return request<PromptLibraryFolder>("/api/prompt-library/folders", { method: "POST", body: JSON.stringify(input) });
}

export function updatePromptLibraryFolder(folderId: string, input: { name: string }) {
    return request<PromptLibraryFolder>(`/api/prompt-library/folders/${encodeURIComponent(folderId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deletePromptLibraryFolder(folderId: string) {
    return request<{ ok: true; id: string; moved: number }>(`/api/prompt-library/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
        ...init,
    }).catch(() => {
        throw new Error("后端服务未启动或网络不可达，请重新运行启动脚本。");
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `提示词库请求失败 (${response.status})`);
    return data;
}
