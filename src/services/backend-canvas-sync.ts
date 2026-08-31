import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type RemoteCanvasProject = {
    serverId: string;
    localProjectId: string;
    version: number;
    updatedAt: string;
    project: CanvasProject;
};

type BootstrapResponse = {
    projects: RemoteCanvasProject[];
};

export class BackendSyncConflictError extends Error {
    readonly statusCode = 409;
    readonly conflict: { localProjectId?: string; currentVersion?: number; updatedAt?: string } | null;

    constructor(message: string, conflict: { localProjectId?: string; currentVersion?: number; updatedAt?: string } | null = null) {
        super(message);
        this.name = "BackendSyncConflictError";
        this.conflict = conflict;
    }
}

export async function bootstrapCanvasProjects() {
    return request<BootstrapResponse>("/api/sync/bootstrap");
}

export async function pushCanvasProjects(projects: CanvasProject[], expectedVersions: Record<string, number> = {}) {
    return request<{ saved: Array<{ serverId: string; localProjectId: string; version: number; updatedAt: string }> }>("/api/sync/push", {
        method: "POST",
        body: JSON.stringify({ projects: projects.map((project) => ({ project, expectedVersion: expectedVersions[project.id] ?? 0 })) }),
    });
}

export function mergeCanvasProjects(localProjects: CanvasProject[], remoteProjects: RemoteCanvasProject[]) {
    const merged = new Map<string, CanvasProject>();
    localProjects.forEach((project) => merged.set(project.id, project));
    remoteProjects.forEach((remote) => {
        const incoming = remote.project;
        const existing = merged.get(incoming.id);
        if (!existing || timestamp(incoming.updatedAt) > timestamp(existing.updatedAt)) {
            merged.set(incoming.id, incoming);
        }
    });
    return Array.from(merged.values()).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
}

function timestamp(value: string) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
        ...init,
    }).catch(() => {
        throw new Error("后端服务未启动或网络不可达，请重新运行启动脚本。");
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string; conflict?: { localProjectId?: string; currentVersion?: number; updatedAt?: string } };
    if (!response.ok) {
        if (response.status === 409) throw new BackendSyncConflictError(data.error || "远端数据已更新", data.conflict || null);
        throw new Error(data.error || backendRequestErrorMessage(response.status));
    }
    return data;
}

function backendRequestErrorMessage(status: number) {
    if (status === 500) return "后端服务未启动或前端代理连接失败，请重新运行启动脚本。";
    return `请求失败 (${status})`;
}
