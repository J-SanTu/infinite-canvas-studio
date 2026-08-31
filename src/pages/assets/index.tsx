import { useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Spin, Tooltip } from "antd";
import { Check, Folder, FolderOpen, FolderPlus, Images, MoreHorizontal, Move, Music2, Pencil, Search, Trash2, Upload } from "lucide-react";

import { ASSET_LIBRARY_IDS_DRAG_MIME, readDraggedAssetIds } from "@/lib/asset-drag";
import { formatBytes } from "@/lib/image-utils";
import { BackendAssetSyncConflictError, mutateAccountAssetLibrary, pushAccountAssetLibrary, type AssetMutation } from "@/services/backend-asset-sync";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset, type AssetFolder } from "@/stores/use-asset-store";

type FolderFilter = "all" | "unfiled" | string;

export default function AssetsPage() {
    const { message, modal } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const accountReady = useAssetStore((state) => state.accountReady);
    const accountLoading = useAssetStore((state) => state.accountLoading);
    const syncError = useAssetStore((state) => state.accountSyncError);
    const addAsset = useAssetStore((state) => state.addAsset);
    const createFolder = useAssetStore((state) => state.createFolder);
    const renameFolder = useAssetStore((state) => state.renameFolder);
    const removeFolder = useAssetStore((state) => state.removeFolder);
    const moveAssets = useAssetStore((state) => state.moveAssets);
    const removeAssets = useAssetStore((state) => state.removeAssets);
    const setSyncError = useAssetStore((state) => state.setAccountSyncError);
    const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
    const [keyword, setKeyword] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [folderEditor, setFolderEditor] = useState<{ open: boolean; folder: AssetFolder | null }>({ open: false, folder: null });
    const [folderName, setFolderName] = useState("");
    const [moveOpen, setMoveOpen] = useState(false);
    const [moveFolderId, setMoveFolderId] = useState("unfiled");
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [uploading, setUploading] = useState(false);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => {
            if (folderFilter === "unfiled" && asset.folderId) return false;
            if (folderFilter !== "all" && folderFilter !== "unfiled" && asset.folderId !== folderFilter) return false;
            if (!query) return true;
            return [asset.title, asset.source || "", ...(asset.tags || [])].join(" ").toLowerCase().includes(query);
        });
    }, [assets, folderFilter, keyword]);

    const persistMutations = async (operations: AssetMutation[], successText?: string) => {
        try {
            await mutateAccountAssetLibrary(operations);
            setSyncError("");
            if (successText) message.success(successText);
            return true;
        } catch (error) {
            if (!(error instanceof BackendAssetSyncConflictError)) {
                try {
                    const state = useAssetStore.getState();
                    await pushAccountAssetLibrary(state.assets, state.folders);
                    setSyncError("");
                    if (successText) message.success(successText);
                    return true;
                } catch {
                    // Fall through to the original mutation error so the sync banner stays actionable.
                }
            }
            const detail = error instanceof Error ? error.message : "素材保存失败";
            setSyncError(detail);
            message.error(detail);
            return false;
        }
    };

    const currentAssetMutations = (ids: string[]): AssetMutation[] =>
        ids.flatMap((id) => {
            const asset = useAssetStore.getState().assets.find((item) => item.id === id);
            return asset ? [{ type: "upsert_asset", asset } satisfies AssetMutation] : [];
        });

    const toggleSelection = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const openFolderEditor = (folder: AssetFolder | null) => {
        setFolderName(folder?.name || "");
        setFolderEditor({ open: true, folder });
    };

    const saveFolder = async () => {
        const name = folderName.trim();
        if (!name) return message.warning("请输入文件夹名称");
        if (folders.some((folder) => folder.id !== folderEditor.folder?.id && folder.name.toLowerCase() === name.toLowerCase())) return message.warning("已存在同名文件夹");
        const editingFolder = folderEditor.folder;
        const folderId = editingFolder ? editingFolder.id : createFolder(name);
        if (editingFolder) renameFolder(editingFolder.id, name);
        setFolderEditor({ open: false, folder: null });
        const folder = useAssetStore.getState().folders.find((item) => item.id === folderId);
        if (folder) await persistMutations([{ type: "upsert_folder", folder }], editingFolder ? "文件夹已重命名" : "文件夹已创建");
    };

    const confirmRemoveFolder = (folder: AssetFolder) => {
        modal.confirm({
            title: `删除“${folder.name}”文件夹？`,
            content: "文件夹内的素材会移动到未分类，不会删除图片。",
            okText: "删除文件夹",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                removeFolder(folder.id);
                if (folderFilter === folder.id) setFolderFilter("unfiled");
                await persistMutations([{ type: "delete_folder", id: folder.id }], "文件夹已删除");
            },
        });
    };

    const moveSelected = async (folderId: string) => {
        if (!selectedIds.size) return;
        const ids = Array.from(selectedIds);
        moveAssets(ids, folderId === "unfiled" ? null : folderId);
        setSelectedIds(new Set());
        setMoveOpen(false);
        await persistMutations(currentAssetMutations(ids), "素材已移动");
    };

    const confirmRemoveSelected = () => {
        if (!selectedIds.size) return;
        modal.confirm({
            title: `删除选中的 ${selectedIds.size} 个素材？`,
            content: "素材记录会从本地工作区移除，画布中的原图片节点不会被删除。",
            okText: "删除素材",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                const ids = Array.from(selectedIds);
                removeAssets(ids);
                setSelectedIds(new Set());
                await persistMutations(
                    ids.map((id) => ({ type: "delete_asset", id })),
                    "素材已删除",
                );
            },
        });
    };

    const handleUpload = async (files: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        if (!imageFiles.length || !accountReady) return;
        setUploading(true);
        const addedIds: string[] = [];
        try {
            for (const file of imageFiles) {
                const image = await uploadImage(file);
                addedIds.push(
                    addAsset({
                        kind: "image",
                        title: file.name.replace(/[.][^.]+$/, "") || "上传图片",
                        coverUrl: image.url,
                        tags: [],
                        folderId: folderFilter !== "all" && folderFilter !== "unfiled" ? folderFilter : null,
                        source: "手动上传",
                        data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                        metadata: { source: "asset-library-upload" },
                    }),
                );
            }
            const operations = currentAssetMutations(addedIds);
            if (!(await persistMutations(operations, `已上传 ${addedIds.length} 个素材`))) removeAssets(addedIds);
        } catch (error) {
            if (addedIds.length) removeAssets(addedIds);
            message.error(error instanceof Error ? error.message : "图片上传失败");
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const handleFolderDrop = async (event: React.DragEvent, folderId: string | null) => {
        event.preventDefault();
        const ids = readDraggedAssetIds(event.dataTransfer);
        if (!ids.length) return;
        moveAssets(ids, folderId);
        setSelectedIds(new Set());
        await persistMutations(currentAssetMutations(ids), "素材已移动");
    };

    if (accountLoading) {
        return (
            <main className="grid h-full place-items-center bg-background">
                <Spin tip="正在加载本地素材" />
            </main>
        );
    }

    return (
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            <header className="flex min-h-16 items-center gap-4 border-b px-6" style={{ borderColor: "rgba(120,113,108,.2)" }}>
                <div className="min-w-0">
                    <h1 className="text-lg font-semibold">我的素材</h1>
                    <p className="truncate text-xs opacity-50">保存在本机工作区</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Input prefix={<Search className="size-4 opacity-45" />} allowClear value={keyword} placeholder="搜索素材" className="w-64" onChange={(event) => setKeyword(event.target.value)} />
                    <Button disabled={!accountReady} icon={<FolderPlus className="size-4" />} onClick={() => openFolderEditor(null)}>
                        新建文件夹
                    </Button>
                    <Button type="primary" disabled={!accountReady} loading={uploading} icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
                        上传图片
                    </Button>
                    <input ref={inputRef} hidden multiple type="file" accept="image/*" onChange={(event) => void handleUpload(event.target.files)} />
                </div>
            </header>

            {syncError ? <div className="border-b border-red-500/25 bg-red-500/10 px-6 py-2 text-sm text-red-500">{syncError}</div> : null}

            <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
                <aside className="min-h-0 overflow-y-auto border-r p-3" style={{ borderColor: "rgba(120,113,108,.2)" }}>
                    <FolderRow active={folderFilter === "all"} label="全部素材" count={assets.length} icon={<Images className="size-4" />} onClick={() => setFolderFilter("all")} />
                    <FolderRow
                        active={folderFilter === "unfiled"}
                        label="未分类"
                        count={assets.filter((asset) => !asset.folderId).length}
                        icon={<FolderOpen className="size-4" />}
                        onClick={() => setFolderFilter("unfiled")}
                        onDrop={(event) => void handleFolderDrop(event, null)}
                    />
                    <div className="mb-2 mt-5 px-2 text-xs font-medium opacity-45">文件夹</div>
                    <div className="space-y-1">
                        {folders.map((folder) => (
                            <FolderRow
                                key={folder.id}
                                active={folderFilter === folder.id}
                                label={folder.name}
                                count={assets.filter((asset) => asset.folderId === folder.id).length}
                                icon={<Folder className="size-4" />}
                                onClick={() => setFolderFilter(folder.id)}
                                onDrop={(event) => void handleFolderDrop(event, folder.id)}
                                actions={
                                    <Tooltip title="文件夹操作">
                                        <Button
                                            type="text"
                                            size="small"
                                            aria-label={`${folder.name}文件夹操作`}
                                            icon={<MoreHorizontal className="size-4" />}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                modal.confirm({
                                                    title: folder.name,
                                                    icon: null,
                                                    content: (
                                                        <div className="mt-4 grid grid-cols-2 gap-2">
                                                            <Button
                                                                icon={<Pencil className="size-4" />}
                                                                onClick={() => {
                                                                    Modal.destroyAll();
                                                                    openFolderEditor(folder);
                                                                }}
                                                            >
                                                                重命名
                                                            </Button>
                                                            <Button
                                                                danger
                                                                icon={<Trash2 className="size-4" />}
                                                                onClick={() => {
                                                                    Modal.destroyAll();
                                                                    confirmRemoveFolder(folder);
                                                                }}
                                                            >
                                                                删除
                                                            </Button>
                                                        </div>
                                                    ),
                                                    footer: null,
                                                });
                                            }}
                                        />
                                    </Tooltip>
                                }
                            />
                        ))}
                    </div>
                </aside>

                <section className="flex min-h-0 flex-col overflow-hidden">
                    <div className="flex min-h-14 items-center gap-3 border-b px-5" style={{ borderColor: "rgba(120,113,108,.16)" }}>
                        <span className="text-sm opacity-60">{filteredAssets.length} 个素材</span>
                        {selectedIds.size ? (
                            <>
                                <span className="h-5 w-px bg-current opacity-15" />
                                <span className="text-sm font-medium">已选 {selectedIds.size} 个</span>
                                <Button size="small" icon={<Move className="size-3.5" />} onClick={() => setMoveOpen(true)}>
                                    移动
                                </Button>
                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={confirmRemoveSelected}>
                                    删除
                                </Button>
                                <Button size="small" type="text" onClick={() => setSelectedIds(new Set())}>
                                    取消选择
                                </Button>
                            </>
                        ) : null}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                        {filteredAssets.length ? (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                                {filteredAssets.map((asset) => (
                                    <AssetCard key={asset.id} asset={asset} selected={selectedIds.has(asset.id)} selectedIds={selectedIds} onToggle={() => toggleSelection(asset.id)} onPreview={() => setPreviewAsset(asset)} />
                                ))}
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个位置还没有素材" className="mt-24" />
                        )}
                    </div>
                </section>
            </div>

            <Modal title={folderEditor.folder ? "重命名文件夹" : "新建文件夹"} open={folderEditor.open} okText="保存" cancelText="取消" onOk={() => void saveFolder()} onCancel={() => setFolderEditor({ open: false, folder: null })}>
                <Input autoFocus maxLength={64} value={folderName} placeholder="文件夹名称" onChange={(event) => setFolderName(event.target.value)} onPressEnter={() => void saveFolder()} />
            </Modal>

            <Modal title={`移动 ${selectedIds.size} 个素材`} open={moveOpen} okText="移动" cancelText="取消" onOk={() => void moveSelected(moveFolderId)} onCancel={() => setMoveOpen(false)}>
                <Select className="w-full" value={moveFolderId} options={[{ label: "未分类", value: "unfiled" }, ...folders.map((folder) => ({ label: folder.name, value: folder.id }))]} onChange={(value) => setMoveFolderId(value)} />
            </Modal>

            <Modal title={previewAsset?.title} open={Boolean(previewAsset)} footer={null} width={760} onCancel={() => setPreviewAsset(null)}>
                {previewAsset ? <AssetPreview asset={previewAsset} /> : null}
            </Modal>
        </main>
    );
}

function FolderRow({ active, label, count, icon, actions, onClick, onDrop }: { active: boolean; label: string; count: number; icon: React.ReactNode; actions?: React.ReactNode; onClick: () => void; onDrop?: (event: React.DragEvent) => void }) {
    return (
        <div
            role="button"
            tabIndex={0}
            className={`group flex h-10 items-center gap-2 rounded-md px-2 text-sm transition ${active ? "bg-stone-200 font-medium text-stone-950 dark:bg-stone-800 dark:text-white" : "hover:bg-stone-100 dark:hover:bg-stone-900"}`}
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onClick();
            }}
            onDragOver={onDrop ? (event) => event.preventDefault() : undefined}
            onDrop={onDrop}
        >
            <span className="opacity-65">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-xs opacity-40">{count}</span>
            {actions}
        </div>
    );
}

function AssetCard({ asset, selected, selectedIds, onToggle, onPreview }: { asset: Asset; selected: boolean; selectedIds: Set<string>; onToggle: () => void; onPreview: () => void }) {
    const cover = asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" ? asset.coverUrl || asset.data.url : "";
    return (
        <article
            draggable
            className={`group relative overflow-hidden rounded-lg border bg-background transition ${selected ? "border-orange-500 ring-1 ring-orange-500" : "border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"}`}
            onDragStart={(event) => {
                const assetIds = selected && selectedIds.size ? Array.from(selectedIds) : [asset.id];
                event.dataTransfer.setData(ASSET_LIBRARY_IDS_DRAG_MIME, JSON.stringify({ assetIds }));
                event.dataTransfer.effectAllowed = "move";
            }}
        >
            <button type="button" className="block aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-900" onClick={onPreview}>
                {cover ? (
                    <img src={cover} alt={asset.title} draggable={false} className="h-full w-full object-contain" />
                ) : asset.kind === "audio" ? (
                    <div className="grid h-full place-items-center">
                        <Music2 className="size-12 opacity-35" />
                    </div>
                ) : (
                    <div className="grid h-full place-items-center px-5 text-sm opacity-45">{asset.title}</div>
                )}
            </button>
            <button
                type="button"
                aria-label={selected ? `取消选择${asset.title}` : `选择${asset.title}`}
                className={`absolute left-2 top-2 grid size-7 place-items-center rounded-md border shadow-sm transition ${selected ? "border-orange-500 bg-orange-500 text-white" : "border-white/50 bg-black/45 text-transparent hover:text-white"}`}
                onClick={onToggle}
            >
                <Check className="size-4" />
            </button>
            <div className="p-3">
                <div className="truncate text-sm font-medium">{asset.title}</div>
                <div className="mt-1 text-xs opacity-45">
                    {asset.kind === "image" ? `${asset.data.width} × ${asset.data.height} · ${formatBytes(asset.data.bytes)}` : asset.kind === "video" ? "视频素材" : asset.kind === "audio" ? `音频素材 · ${formatBytes(asset.data.bytes)}` : "文本素材"}
                </div>
            </div>
        </article>
    );
}

function AssetPreview({ asset }: { asset: Asset }) {
    if (asset.kind === "image") return <img src={asset.data.dataUrl} alt={asset.title} className="mx-auto max-h-[68vh] max-w-full object-contain" />;
    if (asset.kind === "video") return <video src={asset.data.url} controls className="aspect-video w-full bg-black" />;
    if (asset.kind === "audio")
        return (
            <div className="p-5">
                <Music2 className="mx-auto mb-5 size-12 opacity-45" />
                <audio src={asset.data.url} controls className="w-full" />
            </div>
        );
    return <div className="whitespace-pre-wrap text-sm leading-6">{asset.data.content}</div>;
}
