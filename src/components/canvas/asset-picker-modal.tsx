import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Spin } from "antd";
import { Check, Folder, FolderOpen, Images, Music2, Search, X } from "lucide-react";

import { CANVAS_ASSETS_DRAG_MIME } from "@/lib/asset-drag";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string }
    | { kind: "image"; dataUrl: string; title: string; storageKey?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number }
    | { kind: "audio"; url: string; title: string; storageKey?: string; durationMs?: number };

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onInsertMany?: (payloads: InsertAssetPayload[]) => void;
    onClose: () => void;
};

type FolderFilter = "all" | "unfiled" | string;

export function AssetPickerModal({ open, onInsert, onInsertMany, onClose }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const accountReady = useAssetStore((state) => state.accountReady);
    const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
    const [keyword, setKeyword] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!open) return;
        setSelectedIds(new Set());
        setKeyword("");
    }, [open]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => {
            if (folderFilter === "unfiled" && asset.folderId) return false;
            if (folderFilter !== "all" && folderFilter !== "unfiled" && asset.folderId !== folderFilter) return false;
            return !query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query);
        });
    }, [assets, folderFilter, keyword]);

    if (!open) return null;

    const toggleSelected = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const insertSelected = () => {
        const payloads = assets.filter((asset) => selectedIds.has(asset.id)).map(toInsertPayload);
        if (!payloads.length) return;
        if (onInsertMany) onInsertMany(payloads);
        else payloads.forEach(onInsert);
    };

    return (
        <aside
            role="dialog"
            aria-label="选择素材"
            data-canvas-no-zoom
            className="absolute bottom-20 right-5 top-20 z-[85] flex w-[min(620px,calc(100%-40px))] flex-col overflow-hidden rounded-lg border shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <header className="flex min-h-14 items-center gap-3 border-b px-4" style={{ borderColor: theme.toolbar.border }}>
                <FolderOpen className="size-4.5 opacity-65" />
                <h2 className="text-base font-semibold">选择素材</h2>
                <Button type="text" className="ml-auto !h-8 !w-8 !min-w-8 !p-0" aria-label="关闭素材面板" icon={<X className="size-4" />} onClick={onClose} />
            </header>

            {!accountReady ? (
                <div className="grid flex-1 place-items-center">
                    <Spin tip="正在加载本地素材" />
                </div>
            ) : (
                <>
                    <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)]">
                        <nav className="min-h-0 overflow-y-auto border-r p-2" style={{ borderColor: theme.toolbar.border }}>
                            <PickerFolder active={folderFilter === "all"} label="全部" count={assets.length} icon={<Images className="size-4" />} onClick={() => setFolderFilter("all")} />
                            <PickerFolder active={folderFilter === "unfiled"} label="未分类" count={assets.filter((asset) => !asset.folderId).length} icon={<FolderOpen className="size-4" />} onClick={() => setFolderFilter("unfiled")} />
                            <div className="mb-1 mt-4 px-2 text-[11px] opacity-40">文件夹</div>
                            {folders.map((folder) => (
                                <PickerFolder
                                    key={folder.id}
                                    active={folderFilter === folder.id}
                                    label={folder.name}
                                    count={assets.filter((asset) => asset.folderId === folder.id).length}
                                    icon={<Folder className="size-4" />}
                                    onClick={() => setFolderFilter(folder.id)}
                                />
                            ))}
                        </nav>

                        <div className="flex min-h-0 flex-col">
                            <div className="border-b p-3" style={{ borderColor: theme.toolbar.border }}>
                                <Input prefix={<Search className="size-4 opacity-40" />} allowClear value={keyword} placeholder="搜索素材" onChange={(event) => setKeyword(event.target.value)} />
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                                {filtered.length ? (
                                    <div className="grid grid-cols-3 gap-3">
                                        {filtered.map((asset) => {
                                            const selected = selectedIds.has(asset.id);
                                            const dragIds = selected && selectedIds.size ? Array.from(selectedIds) : [asset.id];
                                            return (
                                                <PickerAssetCard
                                                    key={asset.id}
                                                    asset={asset}
                                                    selected={selected}
                                                    onClick={() => toggleSelected(asset.id)}
                                                    onDoubleClick={() => onInsert(toInsertPayload(asset))}
                                                    onDragStart={(event) => {
                                                        const payloads = assets.filter((item) => dragIds.includes(item.id)).map(toInsertPayload);
                                                        event.dataTransfer.setData(CANVAS_ASSETS_DRAG_MIME, JSON.stringify(payloads));
                                                        event.dataTransfer.effectAllowed = "copy";
                                                    }}
                                                />
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有素材" className="mt-20" />
                                )}
                            </div>
                        </div>
                    </div>

                    <footer className="flex min-h-14 items-center gap-3 border-t px-4" style={{ borderColor: theme.toolbar.border }}>
                        <span className="text-sm opacity-55">{selectedIds.size ? `已选 ${selectedIds.size} 个` : `共 ${filtered.length} 个`}</span>
                        <Button className="ml-auto" onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" disabled={!selectedIds.size} onClick={insertSelected}>
                            添加到画布{selectedIds.size ? ` (${selectedIds.size})` : ""}
                        </Button>
                    </footer>
                </>
            )}
        </aside>
    );
}

function PickerFolder({ active, label, count, icon, onClick }: { active: boolean; label: string; count: number; icon: React.ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition ${active ? "bg-stone-200 font-medium text-stone-950 dark:bg-stone-800 dark:text-white" : "hover:bg-stone-100 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <span className="opacity-60">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-[11px] opacity-35">{count}</span>
        </button>
    );
}

function PickerAssetCard({ asset, selected, onClick, onDoubleClick, onDragStart }: { asset: Asset; selected: boolean; onClick: () => void; onDoubleClick: () => void; onDragStart: (event: React.DragEvent<HTMLElement>) => void }) {
    const cover = asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" ? asset.coverUrl || asset.data.url : "";
    return (
        <article
            draggable
            className={`relative overflow-hidden rounded-md border transition ${selected ? "border-orange-500 ring-1 ring-orange-500" : "border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"}`}
            onDragStart={onDragStart}
        >
            <button type="button" className="block w-full text-left" onClick={onClick} onDoubleClick={onDoubleClick}>
                <div className="aspect-square overflow-hidden bg-stone-100 dark:bg-stone-900">
                    {cover ? (
                        <img src={cover} alt={asset.title} draggable={false} className="h-full w-full object-contain" />
                    ) : asset.kind === "audio" ? (
                        <div className="grid h-full place-items-center">
                            <Music2 className="size-10 opacity-35" />
                        </div>
                    ) : (
                        <div className="grid h-full place-items-center px-3 text-xs opacity-45">{asset.title}</div>
                    )}
                </div>
                <div className="truncate px-2 py-2 text-xs font-medium">{asset.title}</div>
            </button>
            <span className={`pointer-events-none absolute right-2 top-2 grid size-6 place-items-center rounded-full border ${selected ? "border-orange-500 bg-orange-500 text-white" : "border-white/50 bg-black/40 text-transparent"}`}>
                <Check className="size-3.5" />
            </span>
        </article>
    );
}

function toInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}
