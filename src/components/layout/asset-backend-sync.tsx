import { App } from "antd";
import { useEffect, useRef } from "react";

import {
    BackendAssetSyncConflictError,
    bootstrapAccountAssetLibrary,
    consumeRecentAssetMutationRevision,
    getAccountAssetChanges,
    getAccountAssetRevision,
    isAssetMutationInFlight,
    pushAccountAssetLibrary,
    replayAccountAssetChanges,
} from "@/services/backend-asset-sync";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

export function AssetBackendSync() {
    const { message, modal } = App.useApp();
    const user = useUserStore((state) => state.user);
    const userInitialized = useUserStore((state) => state.initialized);
    const hydrated = useAssetStore((state) => state.hydrated);
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const accountReady = useAssetStore((state) => state.accountReady);
    const activeUserIdRef = useRef("");
    const bootstrappedRef = useRef(false);
    const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const revisionRef = useRef(0);
    const conflictHandlingRef = useRef(false);
    const skipNextPushRef = useRef(false);
    const syncedFingerprintRef = useRef("");
    const blockedRemoteRevisionRef = useRef(0);

    const recoverConflict = async (error: BackendAssetSyncConflictError) => {
        if (conflictHandlingRef.current || !user) return;
        conflictHandlingRef.current = true;
        const userId = user.id;
        let modalOpened = false;
        try {
            const remote = await bootstrapAccountAssetLibrary();
            if (useUserStore.getState().user?.id !== userId) return;
            modal.confirm({
                title: "素材库同步冲突",
                content: `远端素材库已更新${error.conflict?.currentRevision !== undefined ? `（revision ${error.conflict.currentRevision}）` : ""}。加载远端版本可以避免覆盖其他窗口的素材和文件夹；当前本地未同步的修改不会自动写回。`,
                okText: "加载远端版本",
                cancelText: "暂不处理",
                onOk: () => {
                    skipNextPushRef.current = true;
                    revisionRef.current = remote.revision;
                    syncedFingerprintRef.current = libraryFingerprint(remote.assets, remote.folders);
                    blockedRemoteRevisionRef.current = 0;
                    useAssetStore.getState().completeAccountSession(userId, remote.assets, remote.folders);
                    conflictHandlingRef.current = false;
                    message.success("已加载远端素材库版本");
                },
                onCancel: () => {
                    blockedRemoteRevisionRef.current = remote.revision;
                    conflictHandlingRef.current = false;
                    message.warning("暂未处理素材库冲突，本地修改不会覆盖远端版本");
                },
            });
            modalOpened = true;
        } catch (recoveryError) {
            message.error(recoveryError instanceof Error ? recoveryError.message : "无法读取远端素材库版本");
        } finally {
            if (!modalOpened) conflictHandlingRef.current = false;
        }
    };

    useEffect(() => {
        if (!userInitialized || !hydrated) return;
        if (!user) {
            activeUserIdRef.current = "";
            bootstrappedRef.current = false;
            revisionRef.current = 0;
            syncedFingerprintRef.current = "";
            blockedRemoteRevisionRef.current = 0;
            skipNextPushRef.current = false;
            conflictHandlingRef.current = false;
            useAssetStore.getState().clearAccountSession();
            return;
        }
        if (activeUserIdRef.current === user.id && bootstrappedRef.current) return;

        activeUserIdRef.current = user.id;
        bootstrappedRef.current = false;
        revisionRef.current = 0;
        skipNextPushRef.current = false;
        conflictHandlingRef.current = false;
        useAssetStore.getState().beginAccountSession(user.id);
        void (async () => {
            try {
                const library = await bootstrapAccountAssetLibrary();
                if (useUserStore.getState().user?.id !== user.id) return;
                useAssetStore.getState().completeAccountSession(user.id, library.assets, library.folders);
                revisionRef.current = library.revision;
                syncedFingerprintRef.current = libraryFingerprint(library.assets, library.folders);
                blockedRemoteRevisionRef.current = 0;
                bootstrappedRef.current = true;
            } catch (error) {
                if (useUserStore.getState().user?.id !== user.id) return;
                const detail = error instanceof Error ? error.message : "本地素材同步失败";
                useAssetStore.getState().setAccountSyncError(detail);
                message.error(detail);
            }
        })();
    }, [hydrated, message, user, userInitialized]);

    useEffect(() => {
        if (!user || !hydrated || !accountReady || !bootstrappedRef.current || activeUserIdRef.current !== user.id) return;
        const recentMutationRevision = consumeRecentAssetMutationRevision();
        if (recentMutationRevision !== null) {
            revisionRef.current = recentMutationRevision;
            const state = useAssetStore.getState();
            syncedFingerprintRef.current = libraryFingerprint(state.assets, state.folders);
            blockedRemoteRevisionRef.current = 0;
            return;
        }
        if (skipNextPushRef.current) {
            skipNextPushRef.current = false;
            return;
        }
        if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
        revisionRef.current = getAccountAssetRevision();
        const scheduledRevision = revisionRef.current;
        pushTimerRef.current = setTimeout(() => {
            if (isAssetMutationInFlight()) return;
            if (getAccountAssetRevision() !== scheduledRevision) {
                revisionRef.current = getAccountAssetRevision();
                consumeRecentAssetMutationRevision();
                const latest = useAssetStore.getState();
                syncedFingerprintRef.current = libraryFingerprint(latest.assets, latest.folders);
                return;
            }
            const state = useAssetStore.getState();
            void pushAccountAssetLibrary(state.assets, state.folders, revisionRef.current)
                .then((result) => {
                    revisionRef.current = result.revision;
                    syncedFingerprintRef.current = libraryFingerprint(state.assets, state.folders);
                    blockedRemoteRevisionRef.current = 0;
                })
                .catch((error) => {
                    if (error instanceof BackendAssetSyncConflictError) {
                        void recoverConflict(error);
                        return;
                    }
                    const detail = error instanceof Error ? error.message : "本地素材保存失败";
                    state.setAccountSyncError(detail);
                    message.error(detail);
                });
        }, 700);
        return () => {
            if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
        };
    }, [accountReady, assets, folders, hydrated, message, modal, user]);

    useEffect(() => {
        if (!user || !hydrated || !accountReady || !bootstrappedRef.current || activeUserIdRef.current !== user.id) return;
        const poll = async () => {
            if (isAssetMutationInFlight() || conflictHandlingRef.current) return;
            const recentMutationRevision = consumeRecentAssetMutationRevision();
            if (recentMutationRevision !== null) {
                revisionRef.current = recentMutationRevision;
                const current = useAssetStore.getState();
                syncedFingerprintRef.current = libraryFingerprint(current.assets, current.folders);
                blockedRemoteRevisionRef.current = 0;
                return;
            }
            try {
                const changes = await getAccountAssetChanges(revisionRef.current, 100);
                if (changes.currentRevision <= revisionRef.current || changes.currentRevision === blockedRemoteRevisionRef.current) return;
                const state = useAssetStore.getState();
                const localDirty = syncedFingerprintRef.current !== libraryFingerprint(state.assets, state.folders);
                if (localDirty) {
                    void recoverConflict(new BackendAssetSyncConflictError("远端素材库已更新", { currentRevision: changes.currentRevision }));
                    return;
                }
                const replayed = await replayAccountAssetChanges(state.assets, state.folders, changes.changes);
                if (useUserStore.getState().user?.id !== user.id) return;
                let nextAssets = replayed.assets;
                let nextFolders = replayed.folders;
                if (replayed.requiresBootstrap) {
                    const remote = await bootstrapAccountAssetLibrary();
                    if (useUserStore.getState().user?.id !== user.id) return;
                    revisionRef.current = remote.revision;
                    nextAssets = remote.assets;
                    nextFolders = remote.folders;
                } else {
                    revisionRef.current = replayed.revision;
                }
                skipNextPushRef.current = true;
                syncedFingerprintRef.current = libraryFingerprint(nextAssets, nextFolders);
                useAssetStore.getState().completeAccountSession(user.id, nextAssets, nextFolders);
                message.info("已同步其他窗口的素材变更");
            } catch (error) {
                if (error instanceof BackendAssetSyncConflictError) return;
                message.error(error instanceof Error ? error.message : "素材变更同步失败");
            }
        };
        const timer = window.setInterval(() => void poll(), 5000);
        return () => window.clearInterval(timer);
    }, [accountReady, hydrated, message, user]);

    return null;
}

function libraryFingerprint(assets: unknown, folders: unknown) {
    return JSON.stringify({ assets, folders }, (key, value) => (key === "dataUrl" || key === "coverUrl" || key === "url" ? undefined : value));
}
