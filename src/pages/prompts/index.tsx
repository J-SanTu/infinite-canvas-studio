import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Spin, Tag } from "antd";
import { FileText, FolderPlus, Move, Search, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { PromptFolderSidebar } from "@/components/prompts/prompt-folder-sidebar";
import { PromptLibraryCard } from "@/components/prompts/prompt-library-card";
import { usePromptLibraryQuery } from "@/components/prompts/use-prompt-library-query";
import { useCopyText } from "@/hooks/use-copy-text";
import { createPromptLibraryFolder, deletePromptLibraryFolder, deletePromptLibraryItem, updatePromptLibraryFolder, updatePromptLibraryItem } from "@/services/prompt-library";
import { usePromptLibraryStore } from "@/stores/use-prompt-library-store";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptLibraryFolder, PromptLibraryItem } from "@/types/prompt-library";

export default function PromptsPage() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const user = useUserStore((state) => state.user);
    const scope = "personal" as const;
    const resetForUser = usePromptLibraryStore((state) => state.resetForUser);
    const [folderFilter, setFolderFilter] = useState("all");
    const [keyword, setKeyword] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [detailItem, setDetailItem] = useState<PromptLibraryItem | null>(null);
    const [folderEditor, setFolderEditor] = useState<PromptLibraryFolder | null | "new">(null);
    const [folderName, setFolderName] = useState("");
    const [moveOpen, setMoveOpen] = useState(false);
    const [moveFolderId, setMoveFolderId] = useState("unfiled");
    const [editItem, setEditItem] = useState<PromptLibraryItem | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editPrompt, setEditPrompt] = useState("");
    const [editTags, setEditTags] = useState("");
    const copyText = useCopyText();
    const { query, items, folders, total } = usePromptLibraryQuery({ userId: user?.id, scope, folder: folderFilter, keyword });

    useEffect(() => {
        resetForUser(user.id);
    }, [resetForUser, user.id]);
    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : "提示词库加载失败");
    }, [message, query.error, query.isError]);

    const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds]);
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["prompt-library", user?.id || ""] });
    const toggleSelection = (id: string) =>
        setSelectedIds((current) => {
            const next = new Set(current);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const openFolderEditor = (folder: PromptLibraryFolder | null) => {
        setFolderName(folder?.name || "");
        setFolderEditor(folder || "new");
    };
    const saveFolder = async () => {
        const name = folderName.trim();
        if (!name) return message.warning("请输入文件夹名称");
        try {
            if (folderEditor === "new") await createPromptLibraryFolder({ scope, name });
            else if (folderEditor) await updatePromptLibraryFolder(folderEditor.id, { name });
            setFolderEditor(null);
            await invalidate();
            message.success(folderEditor === "new" ? "文件夹已创建" : "文件夹已重命名");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "文件夹保存失败");
        }
    };
    const confirmDeleteFolder = (folder: PromptLibraryFolder) =>
        modal.confirm({
            title: `删除“${folder.name}”文件夹？`,
            content: "文件夹内的提示词会移动到未分类，图片和提示词不会删除。",
            okText: "删除文件夹",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deletePromptLibraryFolder(folder.id);
                    if (folderFilter === folder.id) setFolderFilter("unfiled");
                    await invalidate();
                    message.success("文件夹已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "文件夹删除失败");
                }
            },
        });
    const moveItems = async (ids: string[], targetFolderId: string | null) => {
        const manageable = items.filter((item) => ids.includes(item.id) && item.canManage);
        if (!manageable.length) return;
        try {
            await Promise.all(manageable.map((item) => updatePromptLibraryItem(item.id, { folderId: targetFolderId })));
            setSelectedIds(new Set());
            setMoveOpen(false);
            await invalidate();
            message.success(`已移动 ${manageable.length} 条提示词`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "移动失败");
        }
    };
    const confirmDeleteItem = (item: PromptLibraryItem) =>
        modal.confirm({
            title: `删除“${item.title}”？`,
            content: "只会删除提示词库记录，不会删除画布节点、生成历史或我的素材。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deletePromptLibraryItem(item.id);
                    setSelectedIds((current) => new Set([...current].filter((id) => id !== item.id)));
                    await invalidate();
                    message.success("提示词已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                }
            },
        });
    const openEdit = (item: PromptLibraryItem) => {
        setEditItem(item);
        setEditTitle(item.title);
        setEditPrompt(item.prompt);
        setEditTags(item.tags.join("，"));
    };
    const saveEdit = async () => {
        if (!editItem || !editPrompt.trim()) return;
        try {
            await updatePromptLibraryItem(editItem.id, {
                title: editTitle.trim(),
                prompt: editPrompt.trim(),
                tags: editTags
                    .split(/[，,]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean),
            });
            setEditItem(null);
            await invalidate();
            message.success("提示词已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新失败");
        }
    };

    return (
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            <header className="flex min-h-16 flex-wrap items-center gap-3 border-b px-5 py-2" style={{ borderColor: "rgba(120,113,108,.2)" }}>
                <div className="min-w-40">
                    <h1 className="text-lg font-semibold">提示词库</h1>
                    <p className="text-xs opacity-50">保存在本机工作区</p>
                </div>
                <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
                    <Input prefix={<Search className="size-4 opacity-45" />} allowClear value={keyword} placeholder="搜索标题、提示词、标签或创建者" className="w-[min(320px,35vw)] min-w-52" onChange={(event) => setKeyword(event.target.value)} />
                    <Button icon={<FolderPlus className="size-4" />} onClick={() => openFolderEditor(null)}>
                        新建文件夹
                    </Button>
                </div>
            </header>
            <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
                <PromptFolderSidebar
                    folders={folders}
                    activeFolder={folderFilter}
                    allCount={folderFilter === "all" ? total : items.length}
                    onSelect={(id) => {
                        setFolderFilter(id);
                        setSelectedIds(new Set());
                    }}
                    onEdit={openFolderEditor}
                    onDelete={confirmDeleteFolder}
                    onDropItems={(ids, target) => void moveItems(ids, target)}
                />
                <section className="flex min-h-0 flex-col overflow-hidden">
                    <div className="flex min-h-14 flex-wrap items-center gap-3 border-b px-5 py-2" style={{ borderColor: "rgba(120,113,108,.16)" }}>
                        <span className="inline-flex items-center gap-2 text-sm opacity-60">
                            <FileText className="size-4" />
                            {total} 条提示词
                        </span>
                        {selectedIds.size ? (
                            <>
                                <span className="h-5 w-px bg-current opacity-15" />
                                <span className="text-sm font-medium">已选 {selectedIds.size} 条</span>
                                <Button size="small" icon={<Move className="size-3.5" />} onClick={() => setMoveOpen(true)}>
                                    移动
                                </Button>
                                <Button size="small" type="text" onClick={() => setSelectedIds(new Set())}>
                                    取消选择
                                </Button>
                            </>
                        ) : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                        {query.isLoading ? (
                            <div className="grid h-60 place-items-center">
                                <Spin />
                            </div>
                        ) : null}
                        {!query.isLoading && items.length ? (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                                {items.map((item) => (
                                    <PromptLibraryCard
                                        key={item.id}
                                        item={item}
                                        selected={selectedIds.has(item.id)}
                                        dragIds={[...selectedIds]}
                                        onToggle={() => toggleSelection(item.id)}
                                        onOpen={() => setDetailItem(item)}
                                        onCopy={() => copyText(item.prompt, "提示词已复制")}
                                        onEdit={() => openEdit(item)}
                                        onDelete={() => confirmDeleteItem(item)}
                                    />
                                ))}
                            </div>
                        ) : null}
                        {!query.isLoading && !items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword ? "没有找到匹配的提示词" : "这个位置还没有提示词"} className="mt-24" /> : null}
                        {query.hasNextPage ? (
                            <div className="mt-6 text-center">
                                <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                                    加载更多
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </section>
            </div>

            <Modal title={folderEditor === "new" ? "新建文件夹" : "重命名文件夹"} open={folderEditor !== null} okText="保存" cancelText="取消" onOk={() => void saveFolder()} onCancel={() => setFolderEditor(null)}>
                <Input autoFocus maxLength={64} value={folderName} onChange={(event) => setFolderName(event.target.value)} onPressEnter={() => void saveFolder()} />
            </Modal>
            <Modal title={`移动 ${selectedIds.size} 条提示词`} open={moveOpen} okText="移动" cancelText="取消" onOk={() => void moveItems([...selectedIds], moveFolderId === "unfiled" ? null : moveFolderId)} onCancel={() => setMoveOpen(false)}>
                <Select className="w-full" value={moveFolderId} options={[{ label: "未分类", value: "unfiled" }, ...folders.map((folder) => ({ label: folder.name, value: folder.id }))]} onChange={setMoveFolderId} />
            </Modal>
            <Modal title={editItem?.title || "编辑提示词"} open={Boolean(editItem)} okText="保存" cancelText="取消" okButtonProps={{ disabled: !editPrompt.trim() }} onOk={() => void saveEdit()} onCancel={() => setEditItem(null)} width={680}>
                <div className="space-y-4">
                    <Input maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                    <Input.TextArea rows={8} maxLength={8000} showCount value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} />
                    <Input value={editTags} placeholder="标签，用逗号分隔" onChange={(event) => setEditTags(event.target.value)} />
                </div>
            </Modal>
            <Modal title={detailItem?.title} open={Boolean(detailItem)} footer={null} width={860} onCancel={() => setDetailItem(null)}>
                {detailItem ? (
                    <div className="grid gap-5 md:grid-cols-[320px_minmax(0,1fr)]">
                        <img src={detailItem.imageUrl} alt={detailItem.title} className="aspect-[4/3] w-full rounded-md bg-stone-100 object-cover dark:bg-stone-900" />
                        <div className="min-w-0">
                            <div className="flex flex-wrap gap-1">
                                {detailItem.tags.map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                ))}
                            </div>
                            <p className="mt-4 max-h-[420px] overflow-y-auto whitespace-pre-wrap text-sm leading-7">{detailItem.prompt}</p>
                            <Button type="primary" className="mt-5" onClick={() => copyText(detailItem.prompt, "提示词已复制")}>
                                复制提示词
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </main>
    );
}
