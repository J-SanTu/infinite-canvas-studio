import localforage from "localforage";
import type { AiConfig } from "@/stores/use-config-store";
import { useConfigStore } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { requestEdit } from "@/services/api/image";
import { fetchLocalApiSettings, updateLocalApiSetting } from "@/services/backend-api-status";
export type Item = { id: string; folder: string; sourceName: string; outputName: string; file: File; status: "waiting" | "processing" | "done" | "failed"; url?: string; error?: string; stage?: string; startedAt?: number };
type StoredItem = Omit<Item, "file"> & { file?: Blob };
export type StoredTask = { id: string; title?: string; createdAt?: number; updatedAt: number; size: string; compress: boolean; retouch?: boolean; items: StoredItem[] };
export const batchStore = localforage.createInstance({ name: "infinite-canvas", storeName: "batch_white_background_tasks" });

const FIDELITY = "保持整套产品的数量、相对排列、朝向、孔位、槽线、截面、接缝及厚度比例。将整组作为整体居中缩放，不重新排列单个零件，不简化密封圈沟槽，不增删配件。不虚构不可辨识的细节。";
const RETOUCH =
    "在结构保真的前提下进行真实电商产品精修：清晰保留可辨识的表面纹理与边缘。根据实际材质保留橡胶细腻哑光、塑料柔和反射及金属自然高光，不混淆材质。采用均匀柔和的中性棚拍光，保留适度明暗层次，避免高光过曝、暗部细节丢失、磨皮、锐化光晕及虚构纹理。保持纯白背景和四周留白。";
const PROMPT =
    "将上传的产品照片转换为标准电商白底产品图。只保留原照片中的主要产品主体，保持真实外形、结构、比例、材质、颜色、孔位、接口、边缘轮廓和可识别细节，不改变产品型号特征。移除原始背景、人物、手部、杂物、环境、桌面和场景元素。产品独立放置在纯白色背景上，背景颜色为 #FFFFFF。产品位于 1:1 正方形画布的正中央，完整可见，不裁切，不贴边，主体最长边约占画布 70% 到 82%，四周保留均匀安全留白。不要出现文字、Logo、水印、人物、彩色背景或强烈投影。";

export type TaskSummary = Omit<StoredTask, "items"> & { items: Pick<Item, "folder" | "status">[] };
const summaryStore = localforage.createInstance({ name: "infinite-canvas", storeName: "batch_white_background_index" });
export let saveQueue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
export const liveTasks = new Map<string, StoredTask>();
let busy = false;
export const isBatchRunning = () => busy;
export const subscribeBatch = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
const notify = () => listeners.forEach((listener) => listener());
export const summarize = (task: StoredTask): TaskSummary => ({ ...task, items: task.items.map(({ folder, status }) => ({ folder, status })) });
export function persistTask(task: StoredTask) {
    const operation = saveQueue
        .catch(() => undefined)
        .then(async () => {
            await batchStore.setItem(`task:${task.id}`, task);
            await summaryStore.setItem(task.id, summarize(task));
        });
    saveQueue = operation;
    return operation;
}
export async function listTasks() {
    await saveQueue;
    if (!(await summaryStore.getItem("__migrated"))) {
        // One-time migration only; subsequent history reads never deserialize image blobs.
        for (const key of await batchStore.keys())
            if (key.startsWith("task:")) {
                const task = await batchStore.getItem<StoredTask>(key);
                if (task) await summaryStore.setItem(task.id, summarize(task));
            }
        await summaryStore.setItem("__migrated", true);
    }
    const tasks: TaskSummary[] = [];
    await summaryStore.iterate<TaskSummary, void>((task, key) => {
        if (key !== "__migrated") tasks.push(task);
    });
    return tasks.sort((a, b) => (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt) || a.id.localeCompare(b.id));
}
export async function loadTask(id: string) {
    await saveQueue;
    const live = liveTasks.get(id);
    if (live) return live;
    const task = await batchStore.getItem<StoredTask>(`task:${id}`);
    if (!task || !task.items.some((item) => item.status === "processing")) return task;
    const recovered: StoredTask = {
        ...task,
        items: task.items.map((item) =>
            item.status !== "processing"
                ? item
                : {
                      ...item,
                      status: item.stage === "压缩中" && item.url ? "done" : "failed",
                      error: item.stage === "压缩中" && item.url ? "上次压缩已中断，已保留 JPG，可仅重试压缩" : "上次处理已中断，请重试失败项",
                  },
        ),
    };
    await persistTask(recovered);
    return recovered;
}

export async function removeTask(id: string) {
    if (liveTasks.has(id)) throw new Error("正在执行的任务不能删除");
    await saveQueue;
    await summaryStore.removeItem(id);
    await batchStore.removeItem(`task:${id}`);
}
let migration: Promise<void> | undefined;
export function migrateTinifyKey() {
    if (!migration)
        migration = (async () => {
            const key = useConfigStore.getState().config.tinifyApiKey;
            if (!key) return;
            const settings = await fetchLocalApiSettings();
            if (!settings.tinify?.configured) await updateLocalApiSetting("tinify", { apiKey: key });
            useConfigStore.getState().updateConfig("tinifyApiKey", "");
        })().finally(() => {
            migration = undefined;
        });
    return migration;
}
export async function executeBatch(task: StoredTask, config: AiConfig, ids: string[], compressionOnly = false) {
    if (busy) throw new Error("已有批量任务正在后台处理，请等待完成");
    busy = true;
    let current = { ...task, items: task.items.map((item) => (ids.includes(item.id) ? { ...item, status: "waiting" as const, stage: "排队中" } : item)) };
    liveTasks.set(task.id, current);
    notify();
    const update = async (id: string, patch: Partial<Item>) => {
        current = { ...current, updatedAt: Date.now(), items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
        liveTasks.set(task.id, current);
        notify();
        await persistTask(current);
    };
    try {
        await persistTask(current);
        await migrateTinifyKey();
        const queue = current.items.filter((item) => ids.includes(item.id));
        const process = async (item: StoredItem) => {
            let stage = compressionOnly ? "图片压缩" : "读取原图";
            try {
                await update(item.id, { status: "processing", stage: compressionOnly ? "压缩中" : "准备图片", startedAt: Date.now(), error: undefined });
                let finalUrl = item.url;
                if (!compressionOnly) {
                    if (!item.file?.size) throw new Error("旧记录缺少原图，请重新选择文件夹");
                    const normalized = await fileDataUrl(item.file as File, "image/jpeg");
                    const reference: ReferenceImage = { id: item.id, name: item.outputName, type: "image/jpeg", dataUrl: normalized };
                    stage = "图片生成";
                    await update(item.id, { stage: "生图中", startedAt: Date.now() });
                    const targetSize = Number(task.size.split("x")[0]);
                    // Retry only insufficient native resolution, always from the original reference.
                    for (let attempt = 0; attempt < 3; attempt++) {
                        stage = "图片生成";
                        await update(item.id, { stage: attempt ? `原生高清重试 ${attempt}/2` : "生图中", startedAt: Date.now() });
                        const result = await requestEdit(
                            { ...config, size: "1:1", quality: attempt > 0 ? "high" : targetSize > 1024 || task.retouch ? "medium" : "low", count: "1", model: config.imageModel || config.model, imageModel: config.imageModel || config.model },
                            `${PROMPT}\n${FIDELITY}${task.retouch ? `\n${RETOUCH}` : ""}\n请输出原生分辨率至少 ${targetSize}×${targetSize} 的正方形图片，不要返回低分辨率预览图。`,
                            [reference],
                            undefined,
                            { preserveNativeSize: true },
                        );
                        const url = result[0]?.dataUrl;
                        if (!url) throw new Error("模型未返回图片");
                        stage = "JPG 导出";
                        await update(item.id, { stage: "检查原生尺寸并导出 JPG", url, startedAt: Date.now() });
                        try {
                            finalUrl = await exportJpeg(url, targetSize);
                            break;
                        } catch (error) {
                            if (!(error instanceof Error) || error.name !== "NativeResolutionError") throw error;
                            if (attempt === 2) throw new Error(`已自动重试 2 次，${error.message}；请检查所选模型或服务商的原生高清输出能力`);
                        }
                    }
                }
                if (!finalUrl) throw new Error("没有可以压缩的已生成图片");
                let warning: string | undefined;
                if (task.compress || compressionOnly) {
                    await update(item.id, { stage: "压缩中", url: finalUrl, startedAt: Date.now() });
                    try {
                        finalUrl = await compressWithTinify(finalUrl);
                    } catch (error) {
                        warning = `压缩未完成：${error instanceof Error ? error.message : "连接失败"}；已保留未压缩 JPG`;
                    }
                }
                await update(item.id, { status: "done", url: finalUrl, error: warning, stage: warning ? "压缩未完成" : "已完成" });
            } catch (error) {
                await update(item.id, { status: compressionOnly && item.url ? "done" : "failed", error: `${stage}失败：${error instanceof Error ? error.message : "未知错误"}` });
            }
        };
        let cursor = 0;
        const worker = async () => {
            while (cursor < queue.length) await process(queue[cursor++]);
        };
        const outcomes = await Promise.allSettled([worker(), worker()]);
        const rejected = outcomes.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
        await saveQueue;
    } finally {
        busy = false;
        liveTasks.delete(task.id);
        notify();
    }
}
async function fileDataUrl(file: File, outputType?: string) {
    const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(file);
    });
    if (!outputType) return source;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new window.Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("图片无法解析，请换一张图片"));
        element.src = source;
    });
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片画布");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(outputType, 0.95);
}
async function compressWithTinify(dataUrl: string) {
    const response = await fetch("/api/tinify/compress", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: await (await fetch(dataUrl)).blob() });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `压缩失败 (${response.status})`);
    }
    return blobDataUrl(await response.blob());
}
async function blobDataUrl(blob: Blob) {
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("压缩结果读取失败"));
        reader.readAsDataURL(blob);
    });
}

async function exportJpeg(source: string, size: number) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`结果读取失败 (${response.status})`);
    const localUrl = URL.createObjectURL(await response.blob());
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new window.Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("返回图片无法解码"));
            image.src = localUrl;
        });
        if (Math.min(image.naturalWidth, image.naturalHeight) < size) throw Object.assign(new Error(`上游实际返回 ${image.naturalWidth}×${image.naturalHeight}，不足以清晰导出 ${size}×${size}；已保留原生预览，未放大冒充高清`), { name: "NativeResolutionError" });
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建图片画布");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, size, size);
        const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
        const width = image.naturalWidth * scale,
            height = image.naturalHeight * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        return canvas.toDataURL("image/jpeg", 0.95);
    } finally {
        URL.revokeObjectURL(localUrl);
    }
}
