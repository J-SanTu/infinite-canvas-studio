import { restoreDefaultModels, saveDefaultModel, retryDefaultModels } from "@/services/default-model-preferences";
import { DiagnosticsPanel } from "@/components/layout/diagnostics-panel";
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Tabs, Tag } from "antd";
import { KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { migrateTinifyKey } from "@/services/batch-white-tasks";
import { ModelPicker } from "@/components/model-picker";
import { fetchLocalApiSettings, refreshLocalApiModels, updateLocalApiSetting, type ApiCapability, type LocalApiConfig, type LocalApiSettings } from "@/services/backend-api-status";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { useConfigStore, type ConfigTabKey, type ModelCapability } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

const API_CAPABILITIES: ApiCapability[] = ["image", "text", "video", "audio", "music"];
const API_LABELS: Record<ApiCapability, string> = { image: "图片", text: "文本", video: "视频", audio: "音频", music: "音乐", tinify: "Tinify 图片压缩" };
const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认图片模型", optionsLabel: "图片模型" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型" },
];

export function AppConfigPanel({ showDoneButton = false, initialTab = "apis" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [settings, setSettings] = useState<LocalApiSettings | null>(null);
    const [loading, setLoading] = useState(false);
    const settingsRef = useRef<LocalApiSettings | null>(null);
    const config = useConfigStore((state) => state.config);
    const { defaultsReady, defaultsError, defaultsSaveStatus, defaultsSaveError, pendingDefaults } = useConfigStore();
    useEffect(() => { void restoreDefaultModels(); }, []);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);

    const loadSettings = async () => {
        setLoading(true);
        try {
            await migrateTinifyKey();
            const next = await fetchLocalApiSettings();
            settingsRef.current = next;
            setSettings(next);
            syncModels(next);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取本地 API 设置失败");
        } finally {
            setLoading(false);
        }
    };

    const syncModels = (next: LocalApiSettings) => useConfigStore.getState().syncApiModels(next);
    const changeSetting = (capability: ApiCapability, next: LocalApiConfig) => {
        if (!settingsRef.current) return;
        const merged = { ...settingsRef.current, [capability]: next };
        settingsRef.current = merged;
        setSettings(merged);
        syncModels(merged);
    };

    useEffect(() => {
        void loadSettings();
    }, []);

    const finishConfig = () => {
        if (defaultsSaveStatus === "saving" || Object.keys(pendingDefaults).length) {
            setActiveTab("models");
            message.warning("默认模型尚未保存完成，请稍候或重试。");
            return;
        }
        setConfigDialogOpen(false);
        message.success(shouldPromptContinue ? "设置已保存，请继续刚才的操作" : "设置已保存");
        clearPromptContinue();
    };

    return (
        <>
            <Tabs
                className="min-w-0 max-w-full [&_.ant-tabs-content]:min-w-0 [&_.ant-tabs-tabpane]:min-w-0"
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    { key: "diagnostics", label: "诊断日志", children: <DiagnosticsPanel /> },
                    {
                        key: "apis",
                        label: "API",
                        children: (
                            <div className="space-y-3">
                                <div className="flex min-w-0 flex-col items-start justify-between gap-3 rounded-lg border border-stone-200 p-3 sm:flex-row dark:border-stone-800">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold">本机 API 配置</div>
                                        <p className="mt-1 text-xs leading-5 text-stone-500">密钥由本地 Node 服务加密保存，不写入浏览器存储，也不会随项目导出。</p>
                                    </div>
                                    <Button className="shrink-0" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void loadSettings()}>
                                        刷新
                                    </Button>
                                </div>
                                {settings ? API_CAPABILITIES.map((capability) => <ApiChannelGroup key={capability} capability={capability} config={settings[capability]} onChange={(next) => changeSetting(capability, next)} />) : null}
                                {settings?.tinify && <ApiSettingCard capability="tinify" config={settings.tinify} onChange={(next) => changeSetting("tinify", next)} />}
                            </div>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <Alert className="mb-4" type="info" showIcon title="模型来自各 API 的上游列表。请选择默认模型；旧模型失效后需重新选择，不会自动替换。列表可见不代表账号一定有调用权限。" />
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker
                                                config={config}
                                                value={pendingDefaults[group.modelKey] ?? config[group.modelKey]}
                                                disabled={!defaultsReady}
                                                onChange={(model) => { void saveDefaultModel(group.modelKey, model); }}
                                                capability={group.capability}
                                                fullWidth
                                            />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mt-5 flex items-center gap-3">
                                    <span role="status" className="text-xs text-stone-500">{defaultsError || (!defaultsReady ? "正在恢复默认模型…" : defaultsSaveStatus === "saving" ? "保存中…" : defaultsSaveStatus === "error" ? `保存失败：${defaultsSaveError || "仍有未保存的选择"}` : defaultsSaveStatus === "saved" ? "已保存；关闭设置、刷新或重启后自动恢复。" : "选择后自动保存。")}</span>
                                    {defaultsError && <Button onClick={() => void restoreDefaultModels()}>重试恢复</Button>}
                                    {defaultsSaveStatus === "error" && <Button onClick={retryDefaultModels}>重试保存</Button>}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "生成偏好",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="画布默认生图张数">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label="默认音频指令">
                                    <Input.TextArea rows={2} value={config.audioInstructions} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        完成
                    </Button>
                </div>
            ) : null}
        </>
    );
}

function ApiChannelGroup({ capability, config, onChange }: { capability: ApiCapability; config: LocalApiConfig; onChange: (next: LocalApiConfig) => void }) {
    const [adding, setAdding] = useState(false);
    const channels = config.channels || (config.configured ? [{ ...config, id: `${capability}-default` }] : []);
    const [draftId, setDraftId] = useState(() => `channel_${crypto.randomUUID()}`);
    return (
        <section className="space-y-3" aria-label={`${API_LABELS[capability]}渠道`}>
            <div className="flex items-center justify-between">
                <strong>
                    {API_LABELS[capability]} API · {channels.length} 个渠道
                </strong>
                <Button
                    disabled={adding}
                    onClick={() => {
                        setDraftId(`channel_${crypto.randomUUID()}`);
                        setAdding(true);
                    }}
                >
                    添加{API_LABELS[capability]}渠道
                </Button>
            </div>
            {channels.map((channel) => (
                <ApiSettingCard key={channel.id} capability={capability} config={channel} onChange={onChange} />
            ))}
            {adding && (
                <ApiSettingCard
                    capability={capability}
                    isNew
                    config={{ ...config, id: draftId, configured: false, name: "", baseUrl: "", apiFormat: "openai", textProtocol: "chat", models: [], availableModels: [], modelsStatus: "unverified", modelsError: "", updatedAt: "", channels: undefined }}
                    onChange={(next) => {
                        onChange(next);
                        setAdding(false);
                    }}
                    onCancel={() => setAdding(false)}
                />
            )}
        </section>
    );
}

function ApiSettingCard({ capability, config, onChange, isNew = false, onCancel }: { capability: ApiCapability; config: LocalApiConfig; onChange: (next: LocalApiConfig) => void; isNew?: boolean; onCancel?: () => void }) {
    const { message, modal } = App.useApp();
    const [name, setName] = useState(config.name);
    const [protocol, setProtocol] = useState(config.apiFormat === "gemini" ? "gemini" : config.textProtocol || "responses");
    const [modelOpen, setModelOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [search, setSearch] = useState("");
    const filtered = config.availableModels.filter((id) => id.toLowerCase().includes(search.toLowerCase()));
    const [baseUrl, setBaseUrl] = useState(config.baseUrl);
    const [apiKey, setApiKey] = useState("");
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setBaseUrl(config.baseUrl);
        setName(config.name);
        setProtocol(config.apiFormat === "gemini" ? "gemini" : config.textProtocol || "responses");
    }, [config.baseUrl, config.name, config.apiFormat, config.textProtocol]);
    const label = API_LABELS[capability];
    const save = async () => {
        setSaving(true);
        try {
            const next = await updateLocalApiSetting(capability, { baseUrl, apiKey, name, channelId: config.id, create: isNew, apiFormat: protocol === "gemini" ? "gemini" : "openai", textProtocol: protocol === "chat" ? "chat" : "responses" });
            setApiKey("");
            onChange(next);
            const saved = next.channels?.find((item) => item.id === config.id) || next;
            if (saved.modelsStatus === "error") message.warning(`${label} API 已保存，但获取模型失败，请查看提示后刷新`);
            else message.success(capability === "tinify" ? `${label} API 已保存` : `${label} API 已保存，已获取 ${saved.availableModels.length} 个模型，请选择默认模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : `${label} API 保存失败`);
        } finally {
            setSaving(false);
        }
    };
    const refresh = async () => {
        setSaving(true);
        try {
            const next = await refreshLocalApiModels(capability, config.id);
            onChange(next);
            const saved = next.channels?.find((item) => item.id === config.id) || next;
            if (saved.modelsStatus === "error") message.error(saved.modelsError);
            else message.success("上游模型已刷新，请确认默认模型");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "刷新失败");
        } finally {
            setSaving(false);
        }
    };
    const selectModels = async (selectedModels: string[]) => {
        setSaving(true);
        try {
            onChange(await updateLocalApiSetting(capability, { channelId: config.id, selectedModels }));
            setModelOpen(false);
            message.success("模型选择已应用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型选择失败");
        } finally {
            setSaving(false);
        }
    };
    const clear = async () => {
        setSaving(true);
        try {
            const next = await updateLocalApiSetting(capability, { channelId: config.id, clear: true });
            setApiKey("");
            onChange(next);
            message.success(`${label} API 已清除`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : `${label} API 清除失败`);
        } finally {
            setSaving(false);
        }
    };
    return (
        <section aria-label={`${label} API ${config.name || "新渠道"}`} className="min-w-0 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <KeyRound className="size-4" />
                    {capability === "tinify" ? label : config.name || "新渠道"}
                    <Tag color={config.configured ? "green" : "default"}>{config.configured ? `已配置 · ${config.apiKeyFingerprint}` : "未配置"}</Tag>
                </div>
                {config.updatedAt ? <span className="text-xs text-stone-500">更新于 {new Date(config.updatedAt).toLocaleString()}</span> : null}
            </div>
            {capability !== "tinify" && (
                <div className="mb-3 grid gap-3 sm:grid-cols-2">
                    <Input aria-label="渠道名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} placeholder="渠道名称（可选，例如 DeepSeek）" />
                    <Select
                        aria-label="接口协议"
                        value={protocol}
                        disabled={saving}
                        onChange={setProtocol}
                        options={[
                            { value: "chat", label: "OpenAI 兼容 · Chat Completions" },
                            { value: "responses", label: "OpenAI · Responses" },
                            { value: "gemini", label: "Gemini 原生" },
                        ]}
                    />
                </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
                <Input aria-label="Base URL" disabled={saving || capability === "tinify"} className="min-w-0" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" addonBefore="Base URL" />
                <Input.Password aria-label="API Key" disabled={saving} className="min-w-0" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.configured ? "留空保留现有密钥" : "输入 API Key"} addonBefore="API Key" />
            </div>
            {capability !== "tinify" && (
                <Button
                    className="mt-3"
                    disabled={saving || config.modelsStatus !== "ready"}
                    onClick={() => {
                        setSelected(config.models);
                        setSearch("");
                        setModelOpen(true);
                    }}
                >
                    选择模型 · 已选 {config.models.length}
                </Button>
            )}
            <Modal
                title={`${config.name || label} · 选择模型`}
                open={modelOpen}
                onCancel={() => {
                    if (!saving) setModelOpen(false);
                }}
                maskClosable={!saving}
                closable={!saving}
                cancelButtonProps={{ disabled: saving }}
                okText="应用"
                cancelText="取消"
                confirmLoading={saving}
                onOk={() => void selectModels(selected)}
            >
                <Input aria-label="搜索模型" placeholder="搜索模型名称" value={search} disabled={saving} onChange={(event) => setSearch(event.target.value)} allowClear />
                <div className="my-3 flex flex-wrap items-center gap-2">
                    <Button disabled={saving || !filtered.length} onClick={() => setSelected((previous) => [...new Set([...previous, ...filtered])])}>
                        选择搜索结果
                    </Button>
                    <Button disabled={saving || !filtered.length} onClick={() => setSelected((previous) => previous.filter((id) => !filtered.includes(id)))}>
                        清空搜索结果
                    </Button>
                    <span>
                        已选 {selected.length} / {config.availableModels.length}
                    </span>
                </div>
                <div className="flex max-h-80 flex-col gap-2 overflow-auto rounded border border-stone-200 p-3" aria-label="模型复选列表">
                    {filtered.map((id) => (
                        <Checkbox key={id} disabled={saving} checked={selected.includes(id)} onChange={(event) => setSelected((previous) => (event.target.checked ? [...previous, id] : previous.filter((value) => value !== id)))}>
                            {id}
                        </Checkbox>
                    ))}
                    {!filtered.length && <p>没有匹配的模型</p>}
                </div>
                <p className="mt-3 text-xs text-stone-500">连续勾选后点击「应用」保存；取消不改变已保存的模型。</p>
            </Modal>
            {capability !== "tinify" && (
                <div className="mt-3 text-xs text-stone-500">
                    {config.modelsStatus === "error" ? (
                        <Alert type="error" showIcon title={config.modelsError} description="API 配置已保存；已保存的默认值及同一来源的历史列表会保留，验证成功前暂停调用。请检查后刷新，不会自动替换模型。" />
                    ) : config.modelsStatus === "ready" ? (
                        <span>
                            已从上游获取 {config.availableModels.length} 个模型，本用途已选 {config.models.length} 个。可调整上方分类，再到「模型」页选择默认模型。
                            {config.modelsFetchedAt ? ` 获取于 ${new Date(config.modelsFetchedAt).toLocaleString()}` : ""}
                        </span>
                    ) : (
                        <span>{config.configured ? "旧模型列表尚未验证，请刷新上游模型后重新选择。" : "填写 API 后保存，自动获取上游模型，无需手填名称。"}</span>
                    )}
                </div>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
                {onCancel && (
                    <Button disabled={saving} onClick={onCancel}>
                        取消添加
                    </Button>
                )}
                {capability !== "tinify" && (
                    <Button
                        icon={<RefreshCw className="size-4" />}
                        disabled={!config.configured || saving || baseUrl !== config.baseUrl || Boolean(apiKey) || name !== config.name || protocol !== (config.apiFormat === "gemini" ? "gemini" : config.textProtocol || "responses")}
                        onClick={() => void refresh()}
                    >
                        刷新模型
                    </Button>
                )}
                <Button
                    danger
                    icon={<Trash2 className="size-4" />}
                    disabled={!config.configured || saving}
                    onClick={() => modal.confirm({ title: "删除此 API 渠道？", content: "使用此渠道的模型将不可用，其他渠道不受影响。", okText: "删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: clear })}
                >
                    清除
                </Button>
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!baseUrl.trim() || (!config.configured && apiKey.trim().length < 8)} onClick={() => void save()}>
                    {capability === "tinify" ? "保存" : "保存并获取模型"}
                </Button>
            </div>
        </section>
    );
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal title="本地设置" open={isConfigOpen} onCancel={() => setConfigDialogOpen(false)} footer={null} width={960} destroyOnHidden>
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function normalizeImageCount(value: string) {
    const count = Number.parseInt(value, 10);
    return String(Number.isFinite(count) ? Math.max(1, Math.min(15, count)) : 1);
}
