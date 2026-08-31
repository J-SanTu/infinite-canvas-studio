import { App } from "antd";
import { useEffect, useRef } from "react";

import { BackendSyncConflictError, bootstrapCanvasProjects, mergeCanvasProjects, pushCanvasProjects } from "@/services/backend-canvas-sync";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

export function CanvasBackendSync() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const replaceProjects = useCanvasStore((state) => state.replaceProjects);
    const activeUserIdRef = useRef("");
    const bootstrappedRef = useRef(false);
    const serverVersionsRef = useRef(new Map<string, number>());
    const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const conflictHandlingRef = useRef(false);
    const skipNextPushRef = useRef(false);
    const observedProjectsRef = useRef(new Map<string, CanvasProject>());

    const recoverConflict = async (error: BackendSyncConflictError) => {
        if (conflictHandlingRef.current) return;
        conflictHandlingRef.current = true;
        try {
            const remote = await bootstrapCanvasProjects();
            const conflictId = error.conflict?.localProjectId;
            const remoteById = new Map(remote.projects.map((item) => [item.localProjectId, item]));
            const affectedIds = conflictId ? [conflictId] : remote.projects.map((item) => item.localProjectId);
            const current = useCanvasStore.getState().projects;
            const next = current.map((project) => {
                if (!affectedIds.includes(project.id)) return project;
                return remoteById.get(project.id)?.project || project;
            });
            skipNextPushRef.current = true;
            replaceProjects(next);
            remote.projects.forEach((item) => serverVersionsRef.current.set(item.localProjectId, item.version));
            bootstrappedRef.current = true;
        } catch (recoveryError) {
            message.error(recoveryError instanceof Error ? recoveryError.message : "无法读取远端画布版本");
        } finally {
            conflictHandlingRef.current = false;
        }
    };

    useEffect(() => {
        if (!user || !hydrated) {
            activeUserIdRef.current = "";
            bootstrappedRef.current = false;
            serverVersionsRef.current.clear();
            observedProjectsRef.current.clear();
            return;
        }
        if (activeUserIdRef.current === user.id && bootstrappedRef.current) return;
        activeUserIdRef.current = user.id;
        bootstrappedRef.current = false;
        serverVersionsRef.current.clear();
        void (async () => {
            try {
                const remote = await bootstrapCanvasProjects();
                remote.projects.forEach((item) => serverVersionsRef.current.set(item.localProjectId, item.version));
                const currentProjects = useCanvasStore.getState().projects;
                const merged = mergeCanvasProjects(currentProjects, remote.projects);
                const changed = JSON.stringify(merged) !== JSON.stringify(currentProjects);
                if (changed) replaceProjects(merged);
                observedProjectsRef.current = new Map(merged.map((project) => [project.id, project]));
                const remoteById = new Map(remote.projects.map((item) => [item.localProjectId, item]));
                const localChanges = currentProjects.filter((project) => {
                    const remoteProject = remoteById.get(project.id);
                    return !remoteProject || timestamp(project.updatedAt) > timestamp(remoteProject.updatedAt) || (timestamp(project.updatedAt) === timestamp(remoteProject.updatedAt) && JSON.stringify(project) !== JSON.stringify(remoteProject.project));
                });
                if (localChanges.length) {
                    const result = await pushCanvasProjects(localChanges, Object.fromEntries(serverVersionsRef.current));
                    result.saved.forEach((item) => serverVersionsRef.current.set(item.localProjectId, item.version));
                }
                bootstrappedRef.current = true;
            } catch (error) {
                if (error instanceof BackendSyncConflictError) {
                    void recoverConflict(error);
                    return;
                }
                message.error(error instanceof Error ? error.message : "本地画布同步失败");
            }
        })();
    }, [hydrated, message, replaceProjects, user]);

    useEffect(() => {
        if (!user || !hydrated || !bootstrappedRef.current || conflictHandlingRef.current) return;
        const previousProjects = observedProjectsRef.current;
        const dirtyProjectIds = projects.filter((project) => previousProjects.get(project.id) !== project).map((project) => project.id);
        observedProjectsRef.current = new Map(projects.map((project) => [project.id, project]));
        if (skipNextPushRef.current) {
            skipNextPushRef.current = false;
            return;
        }
        if (!dirtyProjectIds.length) return;
        if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
        pushTimerRef.current = setTimeout(() => {
            if (conflictHandlingRef.current) return;
            const dirtyIdSet = new Set(dirtyProjectIds);
            const dirtyProjects = useCanvasStore.getState().projects.filter((project) => dirtyIdSet.has(project.id));
            if (!dirtyProjects.length) return;
            void pushCanvasProjects(dirtyProjects, Object.fromEntries(serverVersionsRef.current))
                .then((result) => {
                    result.saved.forEach((item) => serverVersionsRef.current.set(item.localProjectId, item.version));
                })
                .catch((error) => {
                    if (error instanceof BackendSyncConflictError) {
                        void recoverConflict(error);
                        return;
                    }
                    message.error(error instanceof Error ? error.message : "本地画布保存失败");
                });
        }, 900);
        return () => {
            if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
        };
    }, [hydrated, message, projects, replaceProjects, user]);

    return null;
}

function timestamp(value: string) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
}
