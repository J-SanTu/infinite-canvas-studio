import { useEffect, useMemo, useState } from "react";
import { Check, Download, ImageIcon, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { resolveImageUrl } from "@/services/image-storage";
import { CanvasNodeType } from "@/types/canvas";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [coverUrl, setCoverUrl] = useState("");
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };
    const summary = useMemo(() => summarizeProject(project), [project]);

    useEffect(() => {
        let canceled = false;
        const loadCover = async () => {
            const url = summary.cover ? await resolveImageUrl(summary.cover.storageKey, summary.cover.content) : "";
            if (!canceled) setCoverUrl(url);
        };
        void loadCover();
        return () => {
            canceled = true;
        };
    }, [summary.cover]);

    return (
        <article className="group flex min-h-44 cursor-pointer flex-col justify-between rounded-2xl bg-[#f1eee8] p-5 transition hover:bg-[#ebe6dc] dark:bg-white/5 dark:hover:bg-white/10" onClick={() => !editing && open()}>
            <div className="flex flex-col gap-4">
                {coverUrl ? (
                    <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-stone-200 dark:bg-stone-900">
                        <img src={coverUrl} alt={project.title} className="h-full w-full object-cover" />
                        <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">{summary.imageCount} 张图片</div>
                    </div>
                ) : (
                    <div className="flex aspect-[16/9] items-center justify-center rounded-lg border border-dashed border-stone-300 text-stone-400 dark:border-stone-700">
                        <ImageIcon className="size-6" />
                    </div>
                )}
                <div className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => toggleSelected(project.id, event.target.checked)}
                        className="mt-1 size-4 accent-stone-950 dark:accent-stone-100"
                        aria-label={`选择 ${project.title}`}
                    />
                    {editing ? (
                        <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                    ) : (
                        <button
                            type="button"
                            className="min-w-0 cursor-pointer text-left"
                            onClick={(event) => {
                                event.stopPropagation();
                                open();
                            }}
                        >
                            <h2 className="truncate text-xl font-semibold">{project.title}</h2>
                            <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
                                {project.nodes.length} 个节点 · {project.connections.length} 条连线 · {summary.imageCount} 张图片
                            </p>
                            <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-stone-500 dark:text-stone-400">{summary.prompt || "暂无生成关键词描述"}</p>
                        </button>
                    )}
                </div>
            </div>
            <div className="mt-8 flex items-end justify-between gap-3">
                <p className="text-xs text-stone-500">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存名称" />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label="取消重命名" />
                        </>
                    ) : (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects([project], project.title || "无限画布")} aria-label="导出" />
                            <Button type="text" size="small" shape="circle" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label="重命名" />
                            <Button type="text" size="small" shape="circle" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label="删除" />
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}

function summarizeProject(project: CanvasProject) {
    const imageNodes = project.nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.status === "success" && (node.metadata.storageKey || node.metadata.content));
    const cover = [...imageNodes].reverse()[0]?.metadata;
    const prompt =
        [...project.nodes]
            .reverse()
            .map((node) => node.metadata?.prompt || node.metadata?.composerContent || "")
            .find((value) => value.trim())?.trim() || "";
    return {
        imageCount: imageNodes.length,
        cover: cover ? { storageKey: cover.storageKey, content: cover.content || "" } : null,
        prompt,
    };
}
