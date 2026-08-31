export type GenerationRunStatus = "draft" | "queued" | "running" | "succeeded" | "retryable_failed" | "failed" | "canceled";
export type GenerationCapability = "image" | "video" | "audio" | "music" | "text" | "director";

export type GenerationRun = {
    id: string;
    projectId: string | null;
    targetNodeId: string | null;
    sourceNodeIds: string[];
    operation: string;
    capability: GenerationCapability;
    modelId: string;
    requestId: string;
    status: GenerationRunStatus;
    attempt: number;
    parentRunId: string | null;
    outputAssetIds: string[];
    usageEventId: string | null;
    errorCode: string | null;
    errorMessageSafe: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string;
};

export type CreateGenerationRunInput = {
    requestId: string;
    projectId?: string;
    targetNodeId?: string;
    sourceNodeIds?: string[];
    operation?: string;
    capability: GenerationCapability;
    modelId?: string;
    inputSnapshot?: Record<string, unknown>;
    parameterSnapshot?: Record<string, unknown>;
};

export async function createGenerationRun(input: CreateGenerationRunInput) {
    const response = await fetch("/api/generation-runs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    const data = (await response.json().catch(() => ({}))) as { run?: GenerationRun; error?: string };
    if (!response.ok || !data.run) throw new Error(data.error || `任务创建失败 (${response.status})`);
    return data.run;
}

export async function transitionGenerationRun(id: string, status: GenerationRunStatus, patch: Partial<Pick<GenerationRun, "errorCode" | "errorMessageSafe" | "outputAssetIds" | "usageEventId">> = {}) {
    const response = await fetch(`/api/generation-runs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...patch }),
    });
    const data = (await response.json().catch(() => ({}))) as { run?: GenerationRun; error?: string };
    if (!response.ok || !data.run) throw new Error(data.error || `任务状态更新失败 (${response.status})`);
    return data.run;
}

export type ModelCatalogEntry = {
    id: string;
    label: string;
    capability: GenerationCapability;
    enabled: boolean;
    visibleRoles: string[];
    supportsReferences: boolean;
    tags: string[];
};

export async function listGenerationRuns(params: { status?: GenerationRunStatus; capability?: GenerationCapability; limit?: number } = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => value && query.set(key, String(value)));
    const response = await fetch(`/api/generation-runs?${query.toString()}`, { credentials: "include" });
    const data = (await response.json().catch(() => ({}))) as { runs?: GenerationRun[]; total?: number; nextCursor?: string | null; error?: string };
    if (!response.ok) throw new Error(data.error || `任务请求失败 (${response.status})`);
    return { runs: data.runs || [], total: data.total || 0, nextCursor: data.nextCursor || null };
}

export async function retryGenerationRun(id: string) {
    const response = await fetch(`/api/generation-runs/${encodeURIComponent(id)}/retry`, { method: "POST", credentials: "include" });
    const data = (await response.json().catch(() => ({}))) as { run?: GenerationRun; error?: string };
    if (!response.ok || !data.run) throw new Error(data.error || `重试失败 (${response.status})`);
    return data.run;
}

export async function listModelCatalog(capability?: GenerationCapability) {
    const query = capability ? `?capability=${encodeURIComponent(capability)}` : "";
    const response = await fetch(`/api/models/catalog${query}`, { credentials: "include" });
    const data = (await response.json().catch(() => ({}))) as { models?: ModelCatalogEntry[]; error?: string };
    if (!response.ok) throw new Error(data.error || `模型目录请求失败 (${response.status})`);
    return data.models || [];
}
