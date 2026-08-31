import { Download, History, Music2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestMusicGeneration, storeGeneratedMusic } from "@/services/api/music";
import { createGenerationRun, transitionGenerationRun } from "@/services/api/generation-runs";
import { getMediaBlob, persistMediaFile } from "@/services/file-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type GeneratedAudio = {
    id: string;
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    durationMs?: number;
};

type AudioLog = {
    id: string;
    runId?: string;
    createdAt: number;
    prompt: string;
    model: string;
    voice: string;
    format: string;
    speed: string;
    status: "生成中" | "成功" | "失败";
    audio?: GeneratedAudio;
    error?: string;
};

type AudioLogState = AudioLog & { audio?: GeneratedAudio };

const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "audio_generation_logs" });

export default function AudioPage() {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const model = effectiveConfig.audioModel || effectiveConfig.model;
    const [prompt, setPrompt] = useState("");
    const [logs, setLogs] = useState<AudioLogState[]>([]);
    const [result, setResult] = useState<GeneratedAudio | null>(null);
    const [running, setRunning] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
    const [resultRunId, setResultRunId] = useState("");
    const [mode, setMode] = useState<"speech" | "music">("speech");
    const [musicDurationMs, setMusicDurationMs] = useState("30000");

    useEffect(() => {
        void refreshLogs().then(setLogs);
    }, []);

    const settingsSummary = useMemo(
        () => `${audioVoiceLabel(effectiveConfig.audioVoice)} · ${audioFormatLabel(effectiveConfig.audioFormat)} · ${audioSpeedLabel(effectiveConfig.audioSpeed)}`,
        [effectiveConfig.audioFormat, effectiveConfig.audioSpeed, effectiveConfig.audioVoice],
    );

    async function generate() {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入音频提示词");
            return;
        }
        const generationModel = mode === "music" ? "music_v2" : model;
        if (!isAiConfigReady(effectiveConfig, generationModel)) {
            message.warning("请先完成音频模型配置");
            openConfigDialog(true);
            return;
        }

        const log: AudioLog = {
            id: nanoid(),
            createdAt: Date.now(),
            prompt: text,
            model: generationModel,
            voice: effectiveConfig.audioVoice,
            format: effectiveConfig.audioFormat,
            speed: effectiveConfig.audioSpeed,
            status: "生成中",
        };
        setRunning(true);
        setResult(null);
        await saveLog(log);
        let runId = "";
        try {
            const run = await createGenerationRun({
                requestId: `audio_${log.id}`,
                operation: mode === "music" ? "music_generation" : "audio_generation",
                capability: mode === "music" ? "music" : "audio",
                modelId: generationModel,
                inputSnapshot: { prompt: text },
                parameterSnapshot: { voice: effectiveConfig.audioVoice, format: effectiveConfig.audioFormat, speed: effectiveConfig.audioSpeed, instructions: Boolean(effectiveConfig.audioInstructions.trim()) },
            });
            runId = run.id;
            setResultRunId(run.id);
            log.runId = run.id;
            await saveLog(log);
            await transitionGenerationRun(run.id, "running");
            const blob =
                mode === "music"
                    ? await requestMusicGeneration({ ...effectiveConfig, model: generationModel }, text, { model: generationModel, durationMs: Number(musicDurationMs), outputFormat: "mp3_44100_128" })
                    : await requestAudioGeneration({ ...effectiveConfig, model: generationModel }, text);
            const stored = mode === "music" ? await storeGeneratedMusic(blob) : await storeGeneratedAudio(blob, effectiveConfig.audioFormat);
            const audio: GeneratedAudio = { id: nanoid(), url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, mimeType: stored.mimeType, durationMs: stored.durationMs };
            setResult(audio);
            await saveLog({ ...log, status: "成功", audio });
            await transitionGenerationRun(run.id, "succeeded");
            message.success(mode === "music" ? "音乐已生成" : "音频已生成");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "音频生成失败";
            await saveLog({ ...log, runId: runId || undefined, status: "失败", error: errorMessage });
            if (runId) {
                const errorCode = classifyAudioError(errorMessage);
                await transitionGenerationRun(runId, isRetryableAudioError(errorCode) ? "retryable_failed" : "failed", { errorCode, errorMessageSafe: errorMessage }).catch(() => undefined);
            }
            message.error(errorMessage);
        } finally {
            setRunning(false);
        }
    }

    function restoreLog(log: AudioLogState) {
        setPrompt(log.prompt);
        updateConfig("audioVoice", log.voice);
        updateConfig("audioFormat", log.format);
        updateConfig("audioSpeed", log.speed);
        setResult(log.audio || null);
    }

    async function removeLog() {
        if (!deleteLogId) return;
        await logStore.removeItem(deleteLogId);
        setLogs((value) => value.filter((log) => log.id !== deleteLogId));
        setDeleteLogId(null);
    }

    async function saveResultToAssets(audio: GeneratedAudio) {
        try {
            const blob = await getMediaBlob(audio.storageKey);
            if (!blob) throw new Error("音频缓存不存在，请重新生成");
            await persistMediaFile(audio.storageKey, blob);
            const assetId = addAsset({
                kind: "audio",
                title: "生成音频",
                coverUrl: "",
                tags: [],
                source: "音频创作台",
                data: { url: audio.url, storageKey: audio.storageKey, bytes: audio.bytes, mimeType: audio.mimeType, durationMs: audio.durationMs },
                metadata: { source: "audio-page", prompt },
            });
            if (resultRunId) await transitionGenerationRun(resultRunId, "succeeded", { outputAssetIds: [assetId] }).catch(() => undefined);
            message.success("已加入我的素材");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "音频保存失败");
        }
    }

    return (
        <main className="h-full overflow-y-auto bg-stone-50 p-3 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
                <aside className="hidden min-h-0 rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <AudioHistory logs={logs} onRestore={restoreLog} onDelete={setDeleteLogId} />
                </aside>
                <section className="grid gap-3 xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h1 className="text-2xl font-semibold">{mode === "music" ? "音乐创作台" : "音频创作台"}</h1>
                                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{mode === "music" ? "ElevenLabs Music 文本生成音乐" : "文本转语音与旁白生成"}</p>
                            </div>
                            <Button className="lg:hidden" icon={<History className="size-4" />} onClick={() => message.info(`已有 ${logs.length} 条生成记录`)} aria-label="查看生成记录" />
                        </div>
                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="flex gap-2">
                                        <Button type={mode === "speech" ? "primary" : "default"} size="small" onClick={() => setMode("speech")}>
                                            语音
                                        </Button>
                                        <Button type={mode === "music" ? "primary" : "default"} size="small" onClick={() => setMode("music")}>
                                            音乐
                                        </Button>
                                    </div>
                                    <Button size="small" onClick={() => setPromptDialogOpen(true)}>
                                        选择提示词
                                    </Button>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={9} placeholder={mode === "music" ? "描述音乐的风格、情绪、乐器和使用场景" : "输入要朗读的内容，或描述旁白语气"} />
                            </div>
                            {mode === "music" ? (
                                <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-2 text-sm font-semibold">音乐时长（毫秒）</div>
                                    <Input type="number" min={3000} max={600000} step={1000} value={musicDurationMs} onChange={(event) => setMusicDurationMs(event.target.value)} />
                                </div>
                            ) : null}
                            {mode === "speech" ? (
                                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900">
                                    <div className="mb-1 flex items-center gap-2">
                                        <Music2 className="size-4" />
                                        <span className="font-medium">当前设置</span>
                                    </div>
                                    <div className="text-stone-500 dark:text-stone-400">{settingsSummary}</div>
                                </div>
                            ) : null}
                            {mode === "speech" ? (
                                <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-2 text-sm font-semibold">模型</div>
                                    <ModelPicker config={effectiveConfig} value={model} onChange={(value) => updateConfig("audioModel", value)} capability="audio" fullWidth onMissingConfig={() => openConfigDialog(false)} />
                                </div>
                            ) : (
                                <div className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
                                    <div className="font-semibold">音乐模型</div>
                                    <div className="mt-1 text-stone-500">ElevenLabs Music v2</div>
                                </div>
                            )}
                            {mode === "speech" ? <AudioSettingsPanel config={effectiveConfig} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" /> : null}
                        </div>
                        <Button type="primary" size="large" block className="mt-6" icon={<Sparkles className="size-4" />} loading={running} disabled={!prompt.trim() || running} onClick={() => void generate()}>
                            开始生成
                        </Button>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">生成结果</h2>
                            {running ? <Tag>生成中</Tag> : null}
                        </div>
                        {result ? (
                            <AudioResult audio={result} onSave={saveResultToAssets} />
                        ) : (
                            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700">
                                <Music2 className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成音频" />
                            </div>
                        )}
                        {logs.some((log) => log.status === "失败") ? (
                            <div className="mt-4 space-y-2">
                                {logs
                                    .filter((log) => log.status === "失败")
                                    .slice(0, 3)
                                    .map((log) => (
                                        <div key={log.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-950 dark:bg-red-950/20">
                                            <div className="font-medium text-red-700 dark:text-red-300">生成失败</div>
                                            <Typography.Paragraph ellipsis={{ rows: 2 }} className="!mb-0 !mt-1 !text-xs !text-red-600 dark:!text-red-300">
                                                {log.error || "未知错误"}
                                            </Typography.Paragraph>
                                        </div>
                                    ))}
                            </div>
                        ) : null}
                    </div>
                </section>
            </div>
            <div className="mx-auto mt-3 max-w-7xl lg:hidden">
                <details className="rounded-lg border border-stone-200 bg-card p-4 dark:border-stone-800">
                    <summary className="cursor-pointer text-sm font-semibold">生成记录（{logs.length}）</summary>
                    <div className="mt-3">
                        <AudioHistory logs={logs} onRestore={restoreLog} onDelete={setDeleteLogId} />
                    </div>
                </details>
            </div>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <Modal title="删除生成记录" open={Boolean(deleteLogId)} onCancel={() => setDeleteLogId(null)} onOk={() => void removeLog()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除这条音频生成记录吗？
            </Modal>
        </main>
    );
}

function AudioResult({ audio, onSave }: { audio: GeneratedAudio; onSave: (audio: GeneratedAudio) => Promise<void> }) {
    return (
        <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <audio src={audio.url} controls className="w-full" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                <span>
                    {audio.mimeType} · {formatBytes(audio.bytes)}
                </span>
                <div className="flex gap-2">
                    <Button size="small" onClick={() => void onSave(audio)}>
                        加入我的素材
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => saveAs(audio.url, `audio.${audio.mimeType.split("/")[1] || "mp3"}`)}>
                        下载
                    </Button>
                </div>
            </div>
        </div>
    );
}

function AudioHistory({ logs, onRestore, onDelete }: { logs: AudioLogState[]; onRestore: (log: AudioLogState) => void; onDelete: (id: string) => void }) {
    return (
        <div>
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">生成记录</h2>
                <Tag>{logs.length}</Tag>
            </div>
            <div className="space-y-2">
                {logs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-stone-200 bg-background p-3 dark:border-stone-800">
                        <button type="button" className="w-full text-left" onClick={() => onRestore(log)}>
                            <div className="line-clamp-2 text-sm font-medium">{log.prompt}</div>
                            <div className="mt-2 flex flex-wrap gap-1">
                                <Tag className="m-0">{audioVoiceLabel(log.voice)}</Tag>
                                <Tag className="m-0">{log.status}</Tag>
                            </div>
                        </button>
                        <div className="mt-2 flex justify-between text-xs text-stone-500">
                            <span>{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                            <Button type="text" size="small" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(log.id)} aria-label="删除记录" />
                        </div>
                    </div>
                ))}
                {!logs.length ? <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-stone-300 text-sm text-stone-500 dark:border-stone-700">暂无生成记录</div> : null}
            </div>
        </div>
    );
}

async function saveLog(log: AudioLog) {
    await logStore.setItem(log.id, log);
}

async function refreshLogs() {
    const logs: AudioLogState[] = [];
    await logStore.iterate<AudioLogState, void>((value) => logs.push(value));
    return logs.sort((a, b) => b.createdAt - a.createdAt);
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function classifyAudioError(message: string) {
    if (/超时|timeout/i.test(message)) return "timeout";
    if (/限流|额度|429/.test(message)) return "upstream_429";
    if (/鉴权|权限|401|403/.test(message)) return "upstream_403";
    if (/网络|连接|fetch|502|503|500/i.test(message)) return "network_error";
    return "audio_generation_failed";
}

function isRetryableAudioError(code: string) {
    return code === "timeout" || code === "network_error" || code === "upstream_429" || /^upstream_5\d\d$/.test(code);
}
