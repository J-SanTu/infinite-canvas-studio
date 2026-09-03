import { Alert, Spin, message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import { exportDirectorAsset, loadDirectorProject, saveDirectorProject } from "@/services/api/director";
import type { Asset } from "@/stores/use-asset-store";
import type { GenerationRun } from "@/services/api/generation-runs";
import { mergeDirectorPrimaryReference, prepareDirectorPrimaryReference, type DirectorCanvasReference } from "@/lib/director/director-project";

const BRIDGE_SOURCE = "infinite-canvas-director-bridge";
const HOST_SOURCE = "infinite-canvas-host";
const SCHEMA_VERSION = 1;
const MAX_PROJECT_CHARS = 2 * 1024 * 1024;
const MAX_EXPORT_BYTES = 80 * 1024 * 1024;
const EMPTY_REFERENCES: DirectorCanvasReference[] = [];

type DirectorWorkspaceProps = {
    nodeId: string;
    canvasProjectId?: string;
    references?: DirectorCanvasReference[];
    onExport?: (result: { asset: Asset; run: GenerationRun; blob: Blob }) => void | Promise<void>;
};

type BridgeMessage = {
    source?: string;
    schemaVersion?: number;
    type?: string;
    nodeId?: string;
    projectJson?: string;
    kind?: "image" | "video";
    blob?: Blob;
    width?: number;
    height?: number;
    durationMs?: number;
    exportId?: string;
    code?: string;
    message?: string;
};

export function DirectorWorkspace({ nodeId, canvasProjectId, references, onExport }: DirectorWorkspaceProps) {
    const canvasReferences = references || EMPTY_REFERENCES;
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const saveTimerRef = useRef<number | null>(null);
    const savedSnapshotRef = useRef("");
    const pendingSnapshotRef = useRef("");
    const saveInFlightRef = useRef<Promise<void> | null>(null);
    const flushSaveRef = useRef<() => Promise<void>>(async () => undefined);
    const retryAttemptRef = useRef(0);
    const mountedRef = useRef(false);
    const referenceAppliedRef = useRef(false);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState("");
    const [messageApi, contextHolder] = message.useMessage();

    const postToBridge = useCallback(
        (type: string, payload: Record<string, unknown> = {}) => {
            iframeRef.current?.contentWindow?.postMessage({ source: HOST_SOURCE, schemaVersion: SCHEMA_VERSION, type, nodeId, ...payload }, window.location.origin);
        },
        [nodeId],
    );

    useEffect(() => {
        const forwardShortcut = (event: KeyboardEvent) => {
            const target = event.target;
            if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
            if (target instanceof HTMLElement && (target.matches("input, select, textarea") || target.isContentEditable || Boolean(target.closest('[contenteditable="true"]')))) return;
            const code = ["KeyQ", "KeyW", "KeyE", "KeyR"].includes(event.code) ? event.code : "";
            if (!code) return;
            event.preventDefault();
            postToBridge("host:shortcut", { code });
        };
        window.addEventListener("keydown", forwardShortcut);
        return () => window.removeEventListener("keydown", forwardShortcut);
    }, [postToBridge]);

    const scheduleSave = useCallback((delayMs: number) => {
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            void flushSaveRef.current();
        }, delayMs);
    }, []);

    const flushSave = useCallback(async () => {
        if (saveInFlightRef.current) return saveInFlightRef.current;
        const projectJson = pendingSnapshotRef.current;
        if (!projectJson || projectJson === savedSnapshotRef.current) return;

        let failed = false;
        const request = (async () => {
            try {
                await saveDirectorProject(nodeId, projectJson, canvasProjectId);
                savedSnapshotRef.current = projectJson;
                if (pendingSnapshotRef.current === projectJson) pendingSnapshotRef.current = "";
                retryAttemptRef.current = 0;
                if (mountedRef.current) setError("");
            } catch (saveError) {
                failed = true;
                retryAttemptRef.current += 1;
                if (mountedRef.current) {
                    setError(saveError instanceof Error ? saveError.message : "导演工程保存失败");
                    scheduleSave(Math.min(30_000, 1_500 * 2 ** Math.min(4, retryAttemptRef.current - 1)));
                }
            } finally {
                saveInFlightRef.current = null;
                if (!failed && pendingSnapshotRef.current && pendingSnapshotRef.current !== savedSnapshotRef.current && mountedRef.current) scheduleSave(0);
            }
        })();
        saveInFlightRef.current = request;
        return request;
    }, [canvasProjectId, nodeId, scheduleSave]);
    flushSaveRef.current = flushSave;

    const queueSave = useCallback(
        (projectJson: string, delayMs = 600) => {
            if (!projectJson || projectJson === savedSnapshotRef.current) return;
            if (projectJson.length > MAX_PROJECT_CHARS) {
                setError("导演工程超过 2 MB 限制");
                return;
            }
            pendingSnapshotRef.current = projectJson;
            retryAttemptRef.current = 0;
            scheduleSave(delayMs);
        },
        [scheduleSave],
    );

    useEffect(() => {
        mountedRef.current = true;
        const handler = async (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data as BridgeMessage | undefined;
            if (!data || data.source !== BRIDGE_SOURCE || data.schemaVersion !== SCHEMA_VERSION || data.nodeId !== nodeId) return;
            if (data.type === "director:ready") {
                try {
                    const response = await loadDirectorProject(nodeId);
                    let primaryReference: DirectorCanvasReference | null = null;
                    let referenceErrorMessage = "";
                    try {
                        primaryReference = await prepareDirectorPrimaryReference(canvasReferences);
                    } catch (referenceError) {
                        referenceErrorMessage = referenceError instanceof Error ? referenceError.message : "上游参考图准备失败";
                        setError(referenceErrorMessage);
                    }
                    if (response.project?.projectJson) {
                        savedSnapshotRef.current = response.project.projectJson;
                        const projectJson = mergeDirectorPrimaryReference(response.project.projectJson, primaryReference);
                        referenceAppliedRef.current = Boolean(primaryReference);
                        postToBridge("host:load-project", { projectJson });
                        if (projectJson !== response.project.projectJson) queueSave(projectJson, 0);
                    } else {
                        postToBridge("host:request-project");
                    }
                    if (!referenceErrorMessage) setError("");
                } catch (loadError) {
                    setError(loadError instanceof Error ? loadError.message : "导演工程加载失败");
                } finally {
                    setLoading(false);
                }
                return;
            }
            if (data.type === "director:project-snapshot" && typeof data.projectJson === "string") {
                if (!referenceAppliedRef.current && canvasReferences.some((reference) => reference.kind === "image")) {
                    try {
                        const primaryReference = await prepareDirectorPrimaryReference(canvasReferences);
                        const projectJson = mergeDirectorPrimaryReference(data.projectJson, primaryReference);
                        if (projectJson !== data.projectJson) {
                            referenceAppliedRef.current = true;
                            postToBridge("host:load-project", { projectJson });
                            queueSave(projectJson, 0);
                            return;
                        }
                    } catch (referenceError) {
                        setError(referenceError instanceof Error ? referenceError.message : "上游参考图准备失败");
                    }
                }
                queueSave(data.projectJson);
                return;
            }
            if (data.type === "director:error") {
                setError(data.message || "导演台消息校验失败");
                return;
            }
            if (data.type !== "director:export") return;
            const kind = data.kind;
            const blob = data.blob;
            const exportId = String(data.exportId || "");
            const validMime = kind === "image" ? ["image/png", "image/jpeg", "image/webp"].includes(blob?.type || "") : kind === "video" && blob?.type === "video/mp4";
            if (!kind || !(blob instanceof Blob) || !blob.size || blob.size > MAX_EXPORT_BYTES || !validMime || !/^[A-Za-z0-9_-]{8,128}$/.test(exportId)) {
                setError("导演导出不符合文件安全限制");
                return;
            }
            setExporting(true);
            try {
                if (typeof data.projectJson !== "string" || !data.projectJson || data.projectJson.length > MAX_PROJECT_CHARS) throw new Error("导演工程快照无效，请重试");
                if (saveTimerRef.current) {
                    window.clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                }
                if (saveInFlightRef.current) await saveInFlightRef.current;
                if (data.projectJson !== savedSnapshotRef.current) {
                    await saveDirectorProject(nodeId, data.projectJson, canvasProjectId);
                    savedSnapshotRef.current = data.projectJson;
                }
                pendingSnapshotRef.current = "";
                const result = await exportDirectorAsset({ nodeId, canvasProjectId, sourceNodeIds: canvasReferences.map((reference) => reference.nodeId), exportId, kind, blob, width: data.width, height: data.height, durationMs: data.durationMs });
                await onExport?.({ ...result, blob });
                messageApi.success(kind === "image" ? "PNG 已加入素材库" : "MP4 已加入素材库");
                setError("");
            } catch (exportError) {
                setError(exportError instanceof Error ? exportError.message : "导演导出保存失败");
            } finally {
                setExporting(false);
            }
        };
        window.addEventListener("message", handler);
        return () => {
            mountedRef.current = false;
            window.removeEventListener("message", handler);
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            void (async () => {
                await flushSaveRef.current();
                if (pendingSnapshotRef.current && pendingSnapshotRef.current !== savedSnapshotRef.current) await flushSaveRef.current();
            })();
        };
    }, [canvasProjectId, canvasReferences, messageApi, nodeId, onExport, postToBridge, queueSave]);

    return (
        <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#171715]">
            {contextHolder}
            {error ? <Alert className="absolute inset-x-3 top-3 z-20" type="error" showIcon title={error} closable onClose={() => setError("")} /> : null}
            {(loading || exporting) && (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/35">
                    <Spin size="large" description={exporting ? "正在保存导出" : "正在加载工程"} />
                </div>
            )}
            <iframe ref={iframeRef} src={`/director-bridge.html?nodeId=${encodeURIComponent(nodeId)}`} title="Santu Director 预演" className="h-full w-full border-0" allow="fullscreen" />
        </div>
    );
}
