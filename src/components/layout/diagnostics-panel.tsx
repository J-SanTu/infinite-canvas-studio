import { Alert, App, Button } from "antd";
import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { flushDiagnostics } from "@/services/diagnostics";

type Status = { directory: string; lastError: string | null; lastWriteAt: string | null; canOpenDirectory: boolean; retentionDays: number; files: { name: string; bytes: number }[] };
export function DiagnosticsPanel() {
    const { message } = App.useApp();
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const refresh = async () => {
        try {
            const response = await fetch("/api/diagnostics");
            if (!response.ok) throw new Error("无法读取日志状态");
            setStatus(await response.json()); setError("");
        } catch (error) { setError(error instanceof Error ? error.message : "无法读取日志状态"); }
    };
    useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, []);
    const open = async () => {
        try {
            const response = await fetch("/api/diagnostics/open", { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "无法打开日志文件夹");
        } catch (error) { message.error(error instanceof Error ? error.message : "打开失败"); }
    };
    const download = async () => {
        setBusy(true);
        try {
            await flushDiagnostics();
            const response = await fetch("/api/diagnostics/export");
            if (!response.ok) throw new Error("导出失败，请检查日志状态");
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement("a"); link.href = url; link.download = `Santu-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            message.success("诊断日志已导出");
        } catch (error) { message.error(error instanceof Error ? error.message : "导出失败"); }
        finally { setBusy(false); void refresh(); }
    };
    return <div className="space-y-4" data-testid="diagnostics-panel">
        <Alert type={error || status?.lastError ? "error" : "success"} showIcon message={error || status?.lastError || "本地日志记录已开启"} description="记录操作、项目保存、生成任务与错误原因。日志只保存在本机，API 密钥和图片内容不会写入。" />
        <div className="rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-800">
            <div className="font-semibold">日志文件夹</div>
            <div className="mt-2 select-text break-all text-stone-500">{status?.directory || "正在读取…"}</div>
            <div className="mt-3 text-stone-500">最近写入：{status?.lastWriteAt ? new Date(status.lastWriteAt).toLocaleString() : "暂无"}</div>
            <div className="mt-1 text-stone-500">{status?.files.length || 0} 个文件 · {((status?.files.reduce((sum, file) => sum + file.bytes, 0) || 0) / 1024 / 1024).toFixed(2)} MB</div>
        </div>
        <div className="flex flex-wrap gap-2">
            <Button icon={<FolderOpen className="size-4" />} disabled={!status?.canOpenDirectory} onClick={() => void open()}>打开日志文件夹</Button>
            <Button type="primary" icon={<Download className="size-4" />} loading={busy} disabled={!status || Boolean(status.lastError)} onClick={() => void download()}>导出诊断日志</Button>
            <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()}>刷新</Button>
        </div>
        <p className="text-xs leading-6 text-stone-500">按天和 5 MB 分卷，最多保留 30 天，总量上限 200 MB。导出最近最多 20 MB 的日志。遇到报错后，请导出 ZIP 并附上报错时间和截图。日志不包含项目正文，也不能代替项目备份。</p>
    </div>;
}
