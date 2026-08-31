import { ensureImageDurable, resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import type { Asset, AssetFolder } from "@/stores/use-asset-store";

export class BackendAssetSyncConflictError extends Error {
    readonly statusCode = 409;
    readonly conflict: { currentRevision?: number } | null;

    constructor(message: string, conflict: { currentRevision?: number } | null = null) {
        super(message);
        this.name = "BackendAssetSyncConflictError";
        this.conflict = conflict;
    }
}

export type AccountAssetLibrary = {
    assets: Asset[];
    folders: AssetFolder[];
    revision: number;
};

export type AssetMutation = { type: "upsert_asset"; asset: Asset } | { type: "delete_asset"; id: string } | { type: "upsert_folder"; folder: AssetFolder } | { type: "delete_folder"; id: string };

export type AssetChange = {
    id: string;
    revision: number;
    source: string;
    operations: AssetMutation[] | Array<Record<string, unknown>>;
    createdAt: string;
};

let accountAssetRevision = 0;
let recentMutationRevision: number | null = null;
let assetMutationInFlight = 0;

export function getAccountAssetRevision() {
    return accountAssetRevision;
}

export function consumeRecentAssetMutationRevision() {
    const revision = recentMutationRevision;
    recentMutationRevision = null;
    return revision;
}

export function isAssetMutationInFlight() {
    return assetMutationInFlight > 0;
}

export async function bootstrapAccountAssetLibrary() {
    const library = await request<AccountAssetLibrary>("/api/assets/bootstrap");
    accountAssetRevision = Number.isInteger(library.revision) && library.revision >= 0 ? library.revision : 0;
    recentMutationRevision = null;
    return {
        folders: Array.isArray(library.folders) ? library.folders : [],
        assets: await Promise.all((Array.isArray(library.assets) ? library.assets : []).map(hydrateAsset)),
        revision: accountAssetRevision,
    };
}

export async function pushAccountAssetLibrary(assets: Asset[], folders: AssetFolder[], expectedRevision?: number) {
    await Promise.all(assets.filter((asset): asset is Asset & { data: { storageKey: string } } => asset.kind === "image" && "storageKey" in asset.data && Boolean(asset.data.storageKey)).map((asset) => ensureImageDurable(asset.data.storageKey)));
    const result = await request<{ assets: number; folders: number; revision: number; savedAt: string }>("/api/assets/push", {
        method: "POST",
        body: JSON.stringify({ assets, folders, expectedRevision: expectedRevision ?? accountAssetRevision }),
    });
    if (Number.isInteger(result.revision) && result.revision >= 0) accountAssetRevision = result.revision;
    recentMutationRevision = null;
    return result;
}

export async function mutateAccountAssetLibrary(operations: AssetMutation[], expectedRevision?: number) {
    assetMutationInFlight += 1;
    try {
        await Promise.all(
            operations
                .filter((operation) => operation.type === "upsert_asset" && operation.asset.kind === "image" && Boolean(operation.asset.data.storageKey))
                .map((operation) => ensureImageDurable(((operation as Extract<AssetMutation, { type: "upsert_asset" }>).asset as Extract<Asset, { kind: "image" }>).data.storageKey || "")),
        );
        const result = await request<{ applied: number; revision: number; savedAt: string }>("/api/assets/mutations", {
            method: "POST",
            body: JSON.stringify({ operations, expectedRevision: expectedRevision ?? accountAssetRevision }),
        });
        if (Number.isInteger(result.revision) && result.revision >= 0) accountAssetRevision = result.revision;
        recentMutationRevision = result.revision;
        return result;
    } finally {
        assetMutationInFlight -= 1;
    }
}

export async function getAccountAssetChanges(afterRevision = 0, limit = 100) {
    return request<{ changes: AssetChange[]; currentRevision: number; hasMore: boolean }>(`/api/assets/changes?afterRevision=${encodeURIComponent(afterRevision)}&limit=${encodeURIComponent(limit)}`);
}

export async function replayAccountAssetChanges(assets: Asset[], folders: AssetFolder[], changes: AssetChange[]) {
    let nextAssets = [...assets];
    let nextFolders = [...folders];
    let revision = changes.length ? changes[changes.length - 1].revision : 0;

    for (const change of changes) {
        if (change.source === "snapshot") return { requiresBootstrap: true as const, assets, folders, revision };
        for (const rawOperation of change.operations) {
            const operation = rawOperation as Partial<AssetMutation> & { asset?: Asset; folder?: AssetFolder; id?: string; type?: string };
            if (String(operation.type || "") === "snapshot_replace") return { requiresBootstrap: true as const, assets, folders, revision };
            if (operation.type === "upsert_asset" && operation.asset) {
                const asset = await hydrateAsset(operation.asset);
                const index = nextAssets.findIndex((item) => item.id === asset.id);
                if (index === -1) nextAssets = [asset, ...nextAssets];
                else nextAssets[index] = asset;
                continue;
            }
            if (operation.type === "delete_asset" && operation.id) {
                nextAssets = nextAssets.filter((asset) => asset.id !== operation.id);
                continue;
            }
            if (operation.type === "upsert_folder" && operation.folder) {
                const index = nextFolders.findIndex((folder) => folder.id === operation.folder?.id);
                if (index === -1) nextFolders = [...nextFolders, operation.folder];
                else nextFolders[index] = operation.folder;
                continue;
            }
            if (operation.type === "delete_folder" && operation.id) {
                nextFolders = nextFolders.filter((folder) => folder.id !== operation.id);
                nextAssets = nextAssets.map((asset) => (asset.folderId === operation.id ? { ...asset, folderId: null, updatedAt: new Date().toISOString() } : asset));
                continue;
            }
            return { requiresBootstrap: true as const, assets, folders, revision };
        }
        revision = change.revision;
    }
    return { requiresBootstrap: false as const, assets: nextAssets, folders: nextFolders, revision };
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: dataUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl || url, data: { ...asset.data, url } };
    }
    if (asset.kind === "audio" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, data: { ...asset.data, url } };
    }
    return asset;
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
    const data = (await response.json().catch(() => ({}))) as T & { error?: string; conflict?: { currentRevision?: number } };
    if (!response.ok) {
        if (response.status === 409) throw new BackendAssetSyncConflictError(data.error || "远端素材库已更新", data.conflict || null);
        throw new Error(data.error || `素材保存失败 (${response.status})`);
    }
    return data;
}
