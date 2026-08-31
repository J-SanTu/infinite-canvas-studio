import type { Asset } from "@/stores/use-asset-store";
import type { GenerationRun } from "@/services/api/generation-runs";

export type DirectorProject = {
    id: string;
    canvasProjectId: string | null;
    directorNodeId: string;
    schemaVersion: number;
    projectJson: string;
    previewAssetId: string | null;
    createdAt: string;
    updatedAt: string;
};

export async function loadDirectorProject(nodeId: string) {
    return request<{ project: DirectorProject | null }>(`/api/director-projects/${encodeURIComponent(nodeId)}`);
}

export async function saveDirectorProject(nodeId: string, projectJson: string, canvasProjectId?: string) {
    return request<{ project: DirectorProject }>(`/api/director-projects/${encodeURIComponent(nodeId)}`, {
        method: "PUT",
        body: JSON.stringify({ projectJson, canvasProjectId: canvasProjectId || null }),
    });
}

export async function deleteDirectorProject(nodeId: string) {
    return request<{ success: true }>(`/api/director-projects/${encodeURIComponent(nodeId)}`, {
        method: "DELETE",
    });
}

export async function exportDirectorAsset(input: { nodeId: string; kind: "image" | "video"; exportId: string; blob: Blob; width?: number; height?: number; durationMs?: number; canvasProjectId?: string; sourceNodeIds?: string[] }) {
    const query = new URLSearchParams({ kind: input.kind, exportId: input.exportId });
    if (input.width) query.set("width", String(input.width));
    if (input.height) query.set("height", String(input.height));
    if (input.durationMs) query.set("durationMs", String(input.durationMs));
    if (input.canvasProjectId) query.set("canvasProjectId", input.canvasProjectId);
    input.sourceNodeIds?.forEach((nodeId) => query.append("sourceNodeId", nodeId));
    const response = await fetch(`/api/director-projects/${encodeURIComponent(input.nodeId)}/export?${query}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": input.blob.type || (input.kind === "image" ? "image/png" : "video/mp4") },
        body: input.blob,
    }).catch(() => {
        throw new Error("后端服务未启动或网络不可达");
    });
    const data = (await response.json().catch(() => ({}))) as { asset?: Asset; run?: GenerationRun; error?: string };
    if (!response.ok || !data.asset || !data.run) throw new Error(normalizeDirectorError(data.error, response.status, "导演导出保存失败"));
    return { asset: data.asset, run: data.run };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
        ...init,
    }).catch(() => {
        throw new Error("后端服务未启动或网络不可达");
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
        throw new Error(normalizeDirectorError(data.error, response.status, "导演工程请求失败"));
    }
    return data;
}

function normalizeDirectorError(detail: string | undefined, status: number, fallback: string) {
    if (status === 401) return "本地工作区访问失败，请重新打开应用";
    if (status === 403) return "没有权限访问导演台工程";
    if (status === 404) return "导演台接口不存在（HTTP 404）。请确认后端服务已启动并重试";
    if (detail && detail !== "Not found") return detail;
    return `${fallback} (${status})`;
}
