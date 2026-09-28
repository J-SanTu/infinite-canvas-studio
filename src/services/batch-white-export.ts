import { zip } from "fflate";
import type { Item } from "./batch-white-tasks";

export const safeExportName = (value: string) => value.replace(/[\\/<>:"|?*\x00-\x1f]/g, "_").replace(/^\.+$/, "_");

export async function createBatchArchive(items: Pick<Item, "status" | "url" | "folder" | "outputName">[], folder?: string) {
    const files: Record<string, Uint8Array> = Object.create(null);
    for (const item of items.filter((item) => item.status === "done" && item.url && (folder === undefined || item.folder === folder))) {
        const path = `${safeExportName(item.folder)}/${safeExportName(item.outputName)}`;
        if (files[path]) throw new Error("文件名冲突，请分别下载文件夹");
        const response = await fetch(item.url!);
        if (!response.ok) throw new Error(`读取 ${item.outputName} 失败`);
        files[path] = new Uint8Array(await response.arrayBuffer());
    }
    if (!Object.keys(files).length) throw new Error("没有可下载的已完成图片");
    return new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data))));
}
