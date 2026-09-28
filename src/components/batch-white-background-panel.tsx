import { Download, FolderOpen, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { App, Button, Checkbox, Empty, Image, Input, Modal, Pagination, Progress, Select, Tag, Tooltip } from "antd";
import { useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { createBatchArchive, safeExportName } from "@/services/batch-white-export";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import type { AiConfig } from "@/stores/use-config-store";

import { batchStore, loadTask, saveQueue, persistTask, listTasks, removeTask, summarize, liveTasks, isBatchRunning, subscribeBatch, executeBatch, migrateTinifyKey, type Item, type StoredTask, type TaskSummary } from "@/services/batch-white-tasks";
const ACTIVE_TASK_KEY = "active";
export function BatchWhiteBackgroundPanel({ config, onOpenConfig }: { config: AiConfig; onOpenConfig: () => void }) {
    const { message, modal } = App.useApp();
    const skipRestoredSave = useRef(false);
    const navigationVersion = useRef(0);
    const [title, setTitle] = useState("");
    const [createdAt, setCreatedAt] = useState(Date.now());
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renaming, setRenaming] = useState(false);
    const [taskId, setTaskId] = useState(() => nanoid());
    const [historyPage, setHistoryPage] = useState(1);
    const [history, setHistory] = useState<TaskSummary[]>([]);
    useEffect(() => setHistoryPage((page) => Math.min(page, Math.max(1, Math.ceil(history.length / 20)))), [history.length]);
    const [ready, setReady] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const [size, setSize] = useState("1600x1600");
    const [compress, setCompress] = useState(true);
    const [retouch, setRetouch] = useState(false);
    const [items, setItems] = useState<Item[]>([]);
    const [running, setRunning] = useState(isBatchRunning());
    const lock = useRef(isBatchRunning());
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);
    const [folder, setFolder] = useState<string | null>(null);
    const [large, setLarge] = useState(false);
    const [taskUpdatedAt, setTaskUpdatedAt] = useState<number | null>(null);
    const groups = useMemo(() => Array.from(new Set(items.map((item) => item.folder))), [items]);
    const restore = (task: StoredTask) => {
        skipRestoredSave.current = true;
        setTitle(task.title || "");
        setCreatedAt(task.createdAt ?? task.updatedAt);
        setTaskId(task.id);
        setSize(task.size);
        setCompress(task.compress);
        setRetouch(task.retouch === true);
        setItems(task.items.map((item) => ({ ...item, file: new File(item.file ? [item.file] : [], item.sourceName, { type: item.file?.type || "image/png" }), status: item.status === "processing" && !liveTasks.has(task.id) ? "waiting" : item.status })));
        setFolder(null);
        setTaskUpdatedAt(task.updatedAt);
    };
    useEffect(() => {
        let disposed = false;
        void (async () => {
            await saveQueue;
            const legacy = await batchStore.getItem<StoredTask>(ACTIVE_TASK_KEY);
            if (legacy?.items?.length) {
                const migrated = { ...legacy, id: "legacy-batch" };
                if (!(await batchStore.getItem("task:legacy-batch"))) await persistTask(migrated);
                await batchStore.setItem("current-id", migrated.id);
                await batchStore.removeItem(ACTIVE_TASK_KEY);
            }
            const tasks = await listTasks();
            const current = await batchStore.getItem<string>("current-id");
            if (disposed) return;
            setHistory(tasks.sort((a, b) => (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt) || a.id.localeCompare(b.id)));
            const task = current ? await loadTask(current) : null;
            if (!disposed && task) restore(task);
            setReady(true);
        })().catch(() => message.error("读取任务记录失败"));
        return () => {
            disposed = true;
        };
    }, []);
    useEffect(() => {
        if (!ready || !items.length || liveTasks.has(taskId)) return;
        if (skipRestoredSave.current) {
            skipRestoredSave.current = false;
            return;
        }
        const task: StoredTask = { id: taskId, title, createdAt, updatedAt: Date.now(), size, compress, retouch, items: items.map((item) => ({ ...item })) };
        const saved = persistTask(task).then(() => batchStore.setItem("current-id", task.id));
        void saved
            .then(() => {
                setTaskUpdatedAt(task.updatedAt);
                setHistory((list) => [summarize(task), ...list.filter((old) => old.id !== task.id)].sort((a, b) => (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt) || a.id.localeCompare(b.id)));
            })
            .catch(() => message.error("任务保存失败，请勿关闭页面"));
    }, [ready, taskId, title, createdAt, items, size, compress, retouch]);
    const createTask = async () => {
        if (lock.current) return;
        await saveQueue;
        await batchStore.setItem("current-id", "");
        setTaskId(nanoid());
        setTitle("");
        setCreatedAt(Date.now());
        setItems([]);
        setFolder(null);
        setTaskUpdatedAt(null);
        setSelected([]);
        setSize("1600x1600");
        setCompress(true);
        setRetouch(false);
    };
    const openTask = async (task: TaskSummary) => {
        const version = ++navigationVersion.current;
        try {
            await saveQueue;
            const latest = await loadTask(task.id);
            if (version !== navigationVersion.current || !latest) return;
            await batchStore.setItem("current-id", task.id);
            if (version === navigationVersion.current) restore(latest);
        } catch {
            message.error("打开任务失败，请重试");
        }
    };
    const renameTask = async () => {
        const name = renameValue.trim();
        if (!renameId || !name) return;
        setRenaming(true);
        try {
            await saveQueue;
            const task = await batchStore.getItem<StoredTask>(`task:${renameId}`);
            if (!task) throw new Error("记录不存在");
            const next = { ...task, title: name, createdAt: task.createdAt ?? task.updatedAt };
            await persistTask(next);
            setHistory((list) => list.map((value) => (value.id === next.id ? summarize(next) : value)));
            if (taskId === next.id && title !== name) {
                skipRestoredSave.current = true;
                setTitle(name);
            }
            setRenameId(null);
        } catch {
            message.error("重命名失败，请重试");
        } finally {
            setRenaming(false);
        }
    };
    const deleteTasks = () =>
        modal.confirm({
            title: "删除生成记录",
            content: `删除选中的 ${selected.length} 条记录？原始文件不受影响。`,
            okText: "删除",
            cancelText: "取消",
            onOk: async () => {
                await saveQueue;
                for (const id of selected) await removeTask(id);
                setHistory((list) => list.filter((task) => !selected.includes(task.id)));
                if (selected.includes(taskId)) await createTask();
                setSelected([]);
            },
        });
    const choose = (files: FileList | null) => {
        const next = Array.from(files || [])
            .filter((file) => /\.(jpe?g|png|webp)$/i.test(file.name))
            .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "zh-CN", { numeric: true }))
            .map((file) => {
                const parts = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/") || [file.name];
                const group = parts.length > 2 ? parts[1] : parts[0] === file.name ? "未分类" : parts[0];
                return { id: nanoid(), folder: group, sourceName: file.name, outputName: "", status: "waiting" as const, file };
            });
        let counts: Record<string, number> = {};
        const prepared = next.map((item) => {
            counts[item.folder] = (counts[item.folder] || 0) + 1;
            return { ...item, outputName: `${item.folder}-${counts[item.folder]}.jpg` };
        });
        if (!prepared.length) return;
        setTaskId(nanoid());
        setTitle("");
        setCreatedAt(Date.now());
        setItems(prepared);
        setFolder(null);
        if (prepared.length) message.success(`已读取 ${prepared.length} 张图片`);
    };
    useEffect(() => {
        const sync = () => {
            setRunning(isBatchRunning());
            lock.current = isBatchRunning();
            const active = liveTasks.get(taskId);
            if (active) {
                skipRestoredSave.current = true;
                setItems(active.items as Item[]);
                setTaskUpdatedAt(active.updatedAt);
            }
            void listTasks()
                .then(setHistory)
                .catch(() => message.error("读取任务摘要失败"));
        };
        sync();
        return subscribeBatch(sync);
    }, [taskId]);
    useEffect(() => {
        void migrateTinifyKey().catch(() => message.warning("旧 Tinify 密钥迁移未完成，请检查本地服务后重试"));
    }, []);
    const run = async (limit?: number, failedOnly = false, compressionOnly = false, itemId?: string) => {
        if (!items.length || isBatchRunning()) return;
        if (!compressionOnly && !config.imageModel && !config.model) {
            onOpenConfig();
            return;
        }
        const queue = items.filter((item) => (itemId ? item.id === itemId : compressionOnly ? item.status === "done" && !!item.error && !!item.url : failedOnly ? item.status === "failed" : item.status !== "done")).slice(0, limit);
        if (!queue.length) return;
        try {
            await saveQueue;
            await executeBatch(
                { id: taskId, title, createdAt, updatedAt: Date.now(), size, compress, retouch, items },
                config,
                queue.map((item) => item.id),
                compressionOnly,
            );
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务执行失败");
        }
    };
    const [downloading, setDownloading] = useState(false);
    const download = async (currentFolder = false) => {
        if (downloading) return;
        setDownloading(true);
        try {
            const bytes = await createBatchArchive(items, currentFolder ? folder! : undefined);
            saveAs(new Blob([bytes as unknown as BlobPart], { type: "application/zip" }), `${currentFolder ? safeExportName(folder!) : "白底图导出"}_${new Date().toISOString().slice(0, 10)}.zip`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败");
        } finally {
            setDownloading(false);
        }
    };
    const [page, setPage] = useState(1);
    useEffect(() => setPage(1), [taskId, folder]);
    const finished = items.filter((item) => item.status === "done" || item.status === "failed").length;
    const succeeded = items.filter((item) => item.status === "done").length;
    const visible = items.filter((item) => !folder || item.folder === folder);
    const historyTarget = ready ? document.getElementById("batch-task-history") : null;
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <Modal title="重命名任务" open={renameId !== null} onCancel={() => setRenameId(null)} onOk={() => void renameTask()} confirmLoading={renaming} okText="保存" cancelText="取消" okButtonProps={{ disabled: !renameValue.trim() }}>
                <Input
                    maxLength={80}
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onPressEnter={() => {
                        if (!renaming) void renameTask();
                    }}
                    placeholder="输入任务名称"
                />
            </Modal>
            {historyTarget &&
                createPortal(
                    <div className="space-y-4">
                        <div className="flex justify-between">
                            <h2 className="text-lg font-semibold">生成记录</h2>
                            <Tag>{history.length}</Tag>
                        </div>
                        <div className="flex gap-2">
                            <Button disabled={!ready || running} onClick={() => void createTask()}>
                                ＋ 新建
                            </Button>
                            <Button disabled={running || !history.length} onClick={() => setSelected(selected.length === history.length ? [] : history.map((task) => task.id))}>
                                全选
                            </Button>
                            <Button disabled={running || !selected.length} onClick={deleteTasks}>
                                删除
                            </Button>
                        </div>
                        {history.slice((historyPage - 1) * 20, historyPage * 20).map((task) => (
                            <div
                                key={task.id}
                                className={`group relative rounded-lg border p-3 transition-[transform,box-shadow,background-color,border-color] duration-150 motion-reduce:transition-none ${"hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:border-stone-400 hover:bg-stone-100 hover:shadow-md dark:hover:border-stone-500 dark:hover:bg-stone-800 dark:hover:shadow-lg dark:hover:shadow-black/40"} ${task.id === taskId ? "border-stone-400 bg-stone-100 dark:border-stone-400 dark:bg-stone-800/60" : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"}`}
                            >
                                <button
                                    type="button"
                                    aria-pressed={task.id === taskId}
                                    aria-label={`打开任务：${task.title || Array.from(new Set(task.items.map((item) => item.folder))).join("、")}`}
                                    onClick={() => void openTask(task)}
                                    className="absolute inset-0 z-0 rounded-lg cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2 dark:focus-visible:ring-stone-300 dark:focus-visible:ring-offset-stone-950"
                                />
                                <div className="pointer-events-none relative flex items-start gap-2">
                                    <span className="pointer-events-auto relative z-10">
                                        <Checkbox
                                            aria-label="选择记录"
                                            disabled={running}
                                            checked={selected.includes(task.id)}
                                            onChange={(event) => setSelected((list) => (event.target.checked ? [...list, task.id] : list.filter((id) => id !== task.id)))}
                                        />
                                    </span>
                                    <span className="min-w-0 break-words text-stone-900 dark:text-stone-100">{task.title || Array.from(new Set(task.items.map((item) => item.folder))).join("、")}</span>
                                </div>
                                <Button
                                    className="relative z-10 mt-1"
                                    size="small"
                                    type="text"
                                    disabled={running}
                                    onClick={() => {
                                        setRenameId(task.id);
                                        setRenameValue(task.title || Array.from(new Set(task.items.map((item) => item.folder))).join("、"));
                                    }}
                                >
                                    重命名
                                </Button>
                                <div className="pointer-events-none relative mt-2 text-xs text-stone-500 dark:text-stone-400">
                                    创建于 {new Date(task.createdAt ?? task.updatedAt).toLocaleString()}
                                    <br />
                                    {task.items.length} 张 · 成功 {task.items.filter((item) => item.status === "done").length} · 失败 {task.items.filter((item) => item.status === "failed").length}
                                </div>
                            </div>
                        ))}
                        {history.length > 20 && <Pagination size="small" simple current={historyPage} pageSize={20} total={history.length} showSizeChanger={false} onChange={setHistoryPage} />}
                        {!history.length && <Empty description="暂无批量生成记录" />}
                    </div>,
                    historyTarget,
                )}
            {items.length > 0 && (
                <div className="sticky top-0 z-10 rounded-lg border border-stone-200 dark:border-stone-700 bg-card p-3" aria-live="polite">
                    <div className="text-sm">
                        已结束 {finished} / {items.length} 张 · 成功 {succeeded} · 失败 {finished - succeeded} · 处理中 {items.filter((item) => item.status === "processing").length} · 双图并行
                    </div>
                    <Progress percent={Math.round((finished / items.length) * 100)} status={running ? "active" : "normal"} />
                </div>
            )}
            <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept="image/*"
                    {...({ webkitdirectory: "" } as Record<string, string>)}
                    onChange={(event) => {
                        choose(event.target.files);
                        event.target.value = "";
                    }}
                />
                <Button icon={<FolderOpen className="size-4" />} disabled={!ready || running} onClick={() => inputRef.current?.click()}>
                    选择总文件夹
                </Button>
                <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                    {items.length ? `已读取 ${groups.length} 个文件夹，共 ${items.length} 张图片` : "支持递归读取一级文件夹下的图片"}
                    {taskUpdatedAt ? ` · 已自动保存 ${new Date(taskUpdatedAt).toLocaleTimeString()}` : ""}
                </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <label>
                    <div className="mb-1 text-sm font-semibold">导出尺寸</div>
                    <Select disabled={running} className="w-full" value={size} onChange={setSize} options={["800x800", "1600x1600", "2000x2000"].map((value) => ({ value, label: value.replace("x", " × ") }))} />
                </label>
                <div>
                    <div className="mb-1 text-sm font-semibold">图片压缩</div>
                    <div className="flex h-8 items-center gap-2">
                        <Checkbox disabled={running} checked={compress} onChange={(event) => setCompress(event.target.checked)}>
                            压缩图片大小
                        </Checkbox>
                        <Tooltip title="需要填写 Tinify API">
                            <Info className="size-4 text-stone-500 dark:text-stone-400" />
                        </Tooltip>
                    </div>
                </div>
                <div>
                    <div className="mb-1 text-sm font-semibold">产品精修</div>
                    <Tooltip title="改善材质与光影，可能增加生成时间及费用；不恢复不可辨识细节">
                        <Checkbox disabled={running} checked={retouch} onChange={(event) => setRetouch(event.target.checked)}>
                            开启精修
                        </Checkbox>
                    </Tooltip>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button type="primary" loading={running} disabled={!items.some((item) => item.status !== "done")} onClick={() => void run()}>
                    开始生成
                </Button>
                <Button disabled={running || !items.some((item) => item.status !== "done")} onClick={() => void run(1)}>
                    先试生成 1 张
                </Button>
                <Button icon={<Download className="size-4" />} disabled={!items.some((item) => item.status === "done")} loading={downloading} onClick={() => void download()}>
                    下载全部
                </Button>
                <Button icon={<RefreshCw className="size-4" />} disabled={running || !items.some((item) => item.status === "failed")} onClick={() => void run(undefined, true)}>
                    重试失败项
                </Button>
                <Button disabled={downloading || !folder || !items.some((item) => item.folder === folder && item.status === "done")} onClick={() => void download(true)}>
                    下载当前文件夹
                </Button>
                <Button disabled={running || !items.some((item) => item.status === "done" && item.error)} onClick={() => void run(undefined, false, true)}>
                    重试未完成压缩
                </Button>
                <Button onClick={() => setLarge((value) => !value)}>{large ? "小图" : "大图"}</Button>
            </div>
            <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
                <aside className="w-40 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                    <Button type={!folder ? "primary" : "text"} block onClick={() => setFolder(null)}>
                        全部
                    </Button>
                    {groups.map((group) => (
                        <Button key={group} type={folder === group ? "primary" : "text"} block className="!text-left" onClick={() => setFolder(group)}>
                            {group}
                        </Button>
                    ))}
                </aside>
                <div className={`min-h-0 flex-1 overflow-y-auto ${large ? "grid grid-cols-2 gap-4" : "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"}`}>
                    {visible.length ? (
                        visible.slice((page - 1) * 24, page * 24).map((item) => (
                            <div title={item.error} key={item.id} className="min-w-0 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                                {item.url ? (
                                    <Image loading="lazy" src={item.url} alt={item.outputName} className="aspect-square object-cover" />
                                ) : (
                                    <div className="flex aspect-square min-w-0 items-center justify-center overflow-hidden bg-stone-50 p-3 text-center text-xs leading-5 text-stone-500 dark:text-stone-400 break-words dark:bg-stone-900">
                                        {item.status === "processing" ? <LoaderCircle className="animate-spin" /> : item.status === "failed" ? <span className="line-clamp-5">{item.error}</span> : "等待生成"}
                                    </div>
                                )}
                                <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                                    <span className="truncate">{item.outputName}</span>
                                    <Tag className="m-0 shrink-0">{item.status === "done" ? (item.error ? "已生成 · 压缩未完成" : "已完成") : item.status === "failed" ? "处理失败" : item.status === "processing" ? item.stage || "处理中" : "排队中"}</Tag>
                                </div>
                                {item.status === "done" && item.error && (
                                    <Button size="small" disabled={running} onClick={() => void run(undefined, false, true, item.id)}>
                                        仅重试压缩
                                    </Button>
                                )}
                                {item.error && <div className="px-2 pb-2 text-xs text-amber-700 dark:text-amber-300 break-words">{item.error}</div>}
                                {item.status === "processing" && (
                                    <div className="px-2 pb-2 text-xs text-stone-500 dark:text-stone-400">
                                        {item.stage} · 已等待 {Math.max(0, Math.floor((now - (item.startedAt || now)) / 1000))} 秒{now - (item.startedAt || now) > 120000 ? " · 耗时较长，仍在等待返回" : ""}
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="col-span-full flex min-h-64 items-center justify-center">
                            <Empty description="请选择总文件夹" />
                        </div>
                    )}
                </div>
            </div>
            {visible.length > 24 && <Pagination current={page} pageSize={24} total={visible.length} showSizeChanger={false} onChange={setPage} />}
            {running && <div className="text-xs text-stone-500 dark:text-stone-400">任务正在应用后台运行，可切换页面；请勿刷新或关闭应用。</div>}
        </div>
    );
}
