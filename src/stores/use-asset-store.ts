import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string; durationMs?: number } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

export type AssetFolder = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
};

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    folderId?: string | null;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    folders: AssetFolder[];
    accountUserId: string | null;
    accountReady: boolean;
    accountLoading: boolean;
    accountSyncError: string;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    removeAssets: (ids: string[]) => void;
    moveAssets: (ids: string[], folderId: string | null) => void;
    createFolder: (name: string) => string;
    renameFolder: (id: string, name: string) => void;
    removeFolder: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    replaceFolders: (folders: AssetFolder[]) => void;
    beginAccountSession: (userId: string) => void;
    completeAccountSession: (userId: string, assets: Asset[], folders: AssetFolder[]) => void;
    clearAccountSession: () => void;
    setAccountSyncError: (message: string) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        const assets = Array.isArray(parsed.state.assets) ? parsed.state.assets : [];
        parsed.state.assets = await Promise.all(
            assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image" || !asset.data.storageKey) return asset;
                const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") || !asset.coverUrl ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
            }),
        );
        parsed.state.folders = Array.isArray(parsed.state.folders) ? parsed.state.folders : [];
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            folders: [],
            accountUserId: null,
            accountReady: false,
            accountLoading: false,
            accountSyncError: "",
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, folderId: asset.folderId || null, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) => get().removeAssets([id]),
            removeAssets: (ids) =>
                set((state) => {
                    const removing = new Set(ids);
                    const assets = state.assets.filter((asset) => !removing.has(asset.id));
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            moveAssets: (ids, folderId) =>
                set((state) => {
                    const moving = new Set(ids);
                    const validFolderId = folderId && state.folders.some((folder) => folder.id === folderId) ? folderId : null;
                    const now = new Date().toISOString();
                    return { assets: state.assets.map((asset) => (moving.has(asset.id) ? ({ ...asset, folderId: validFolderId, updatedAt: now } as Asset) : asset)) };
                }),
            createFolder: (name) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ folders: [...state.folders, { id, name: name.trim().slice(0, 64), createdAt: now, updatedAt: now }] }));
                return id;
            },
            renameFolder: (id, name) =>
                set((state) => ({
                    folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name: name.trim().slice(0, 64), updatedAt: new Date().toISOString() } : folder)),
                })),
            removeFolder: (id) =>
                set((state) => {
                    const now = new Date().toISOString();
                    return {
                        folders: state.folders.filter((folder) => folder.id !== id),
                        assets: state.assets.map((asset) => (asset.folderId === id ? ({ ...asset, folderId: null, updatedAt: now } as Asset) : asset)),
                    };
                }),
            replaceAssets: (assets) => set({ assets }),
            replaceFolders: (folders) => set({ folders }),
            beginAccountSession: (userId) => set({ accountUserId: userId, accountReady: false, accountLoading: true, accountSyncError: "", assets: [], folders: [] }),
            completeAccountSession: (userId, assets, folders) => set({ accountUserId: userId, accountReady: true, accountLoading: false, accountSyncError: "", assets, folders }),
            clearAccountSession: () => set({ accountUserId: null, accountReady: false, accountLoading: false, accountSyncError: "", assets: [], folders: [] }),
            setAccountSyncError: (accountSyncError) => set({ accountSyncError, accountLoading: false }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets, folders: state.folders }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
