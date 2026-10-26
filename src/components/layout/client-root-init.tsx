import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import localforage from "localforage";

import { CanvasBackendSync } from "@/components/layout/canvas-backend-sync";
import { AssetBackendSync } from "@/components/layout/asset-backend-sync";
import { PromptLibrarySessionSync } from "@/components/layout/prompt-library-session-sync";
import { useConfigStore } from "@/stores/use-config-store";
import { fetchLocalApiSettings, refreshLocalApiModels, type ApiCapability } from "@/services/backend-api-status";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const checkedFirstRun = useRef(false);
    const handledCacheClear = useRef(false);
    const cacheClearMode = useMemo(() => new URLSearchParams(window.location.search).get("clearCanvasCache") === "1", []);
    const [clearingCache, setClearingCache] = useState(cacheClearMode);

    useEffect(() => {
        if (cacheClearMode || checkedFirstRun.current) return;
        checkedFirstRun.current = true;
        void fetchLocalApiSettings()
            .then(async (settings) => {
                useConfigStore.getState().syncApiModels(settings);
                const legacy = Object.values(settings)
                    .flatMap((group) => group.channels || [group])
                    .filter((item) => item.configured && item.modelsStatus === "unverified");
                if (legacy.length) {
                    await Promise.all(
                        legacy.map(async (item) => {
                            try {
                                return await refreshLocalApiModels(item.capability as ApiCapability, item.id);
                            } catch {
                                return item;
                            }
                        }),
                    );
                    const latest = await fetchLocalApiSettings();
                    useConfigStore.getState().syncApiModels(latest);
                    message.info("API 模型列表已更新，请到设置中确认默认模型；获取失败的 API 可手动刷新");
                }
                if (Object.values(settings).some((item) => item.configured || item.channels?.some((channel) => channel.configured)) || window.location.pathname === "/config") return;
                window.location.replace("/config?firstRun=1");
            })
            .catch(() => undefined);
    }, [cacheClearMode, openConfigDialog]);

    useEffect(() => {
        if (handledCacheClear.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get("clearCanvasCache") !== "1") return;
        handledCacheClear.current = true;
        void clearCanvasCache().then(() => {
            useCanvasStore.setState({ projects: [] });
            useAssetStore.getState().clearAccountSession();
            searchParams.delete("clearCanvasCache");
            message.success("画布缓存已清理，请重新导入图片");
            setClearingCache(false);
            window.location.replace(`/${searchParams.size ? `?${searchParams}` : ""}`);
        });
    }, [message]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        openConfigDialog(false, "apis");
        message.info("请在本地设置中保存 API 配置");
    }, [message, openConfigDialog]);

    if (clearingCache) {
        return <main className="flex h-screen items-center justify-center bg-background text-sm text-foreground">正在清理画布缓存...</main>;
    }

    return (
        <>
            <CanvasBackendSync />
            <AssetBackendSync />
            <PromptLibrarySessionSync />
            {children}
        </>
    );
}

async function clearCanvasCache() {
    await fetch("/api/sync/clear-cache", { method: "POST" }).catch(() => undefined);
    const appStateStore = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });
    const imageStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
    const imageUploadQueueStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_upload_queue" });
    const mediaStore = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
    await Promise.allSettled([appStateStore.removeItem("infinite-canvas:canvas_store"), appStateStore.removeItem("infinite-canvas:asset_store"), imageStore.clear(), imageUploadQueueStore.clear(), mediaStore.clear()]);
    try {
        window.localStorage.removeItem("infinite-canvas:canvas_store:mirror");
    } catch {
        // Ignore localStorage cleanup failures.
    }
}
