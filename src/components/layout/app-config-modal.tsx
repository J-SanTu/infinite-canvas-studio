import { App, Button, Form, Input, Modal, Select, Tabs, Tag } from "antd";
import { KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { fetchLocalApiSettings, updateLocalApiSetting, type ApiCapability, type LocalApiConfig, type LocalApiSettings } from "@/services/backend-api-status";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { BACKEND_API_CHANNEL_ID, encodeChannelModel, filterModelsByCapability, modelOptionLabel, normalizeModelOptionValue, useConfigStore, type ConfigTabKey, type ModelCapability } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

const API_CAPABILITIES: ApiCapability[] = ["image", "text", "video", "audio", "music"];
const API_LABELS: Record<ApiCapability, string> = { image: "图片", text: "文本", video: "视频", audio: "音频", music: "音乐" };
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
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const modelOptions = config.models.map((model) => ({ label: modelOptionLabel(config, model), value: model }));

    const loadSettings = async () => {
        setLoading(true);
        try {
            const next = await fetchLocalApiSettings();
            setSettings(next);
            syncModels(next);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取本地 API 设置失败");
        } finally {
            setLoading(false);
        }
    };

    const syncModels = (next: LocalApiSettings) => {
        const allRawModels = unique(API_CAPABILITIES.flatMap((capability) => next[capability].models));
        const channel = { ...config.channels[0], id: BACKEND_API_CHANNEL_ID, name: "本地 API", baseUrl: "/api/ai", apiKey: "backend-managed", apiFormat: "openai" as const, models: allRawModels };
        const allModels = allRawModels.map((model) => encodeChannelModel(BACKEND_API_CHANNEL_ID, model));
        updateConfig("channels", [channel]);
        updateConfig("models", allModels);
        for (const group of modelGroups) {
            const rawModels = next[group.capability].models;
            const models = rawModels.map((model) => encodeChannelModel(BACKEND_API_CHANNEL_ID, model));
            updateConfig(group.modelsKey, models);
            if (!models.includes(config[group.modelKey])) updateConfig(group.modelKey, models[0] || "");
        }
    };

    useEffect(() => {
        void loadSettings();
    }, []);

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = unique(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter(Boolean));
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const finishConfig = () => {
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
                                {settings
                                    ? API_CAPABILITIES.map((capability) => (
                                          <ApiSettingCard
                                              key={capability}
                                              capability={capability}
                                              config={settings[capability]}
                                              onChange={(next) => {
                                                  const merged = { ...settings, [capability]: next };
                                                  setSettings(merged);
                                                  syncModels(merged);
                                              }}
                                          />
                                      ))
                                    : null}
                            </div>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelsKey} label={group.optionsLabel}>
                                            <Select mode="tags" showSearch allowClear maxTagCount="responsive" value={config[group.modelsKey]} options={modelOptions} onChange={(models) => updateCapabilityModels(group, models)} />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
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

function ApiSettingCard({ capability, config, onChange }: { capability: ApiCapability; config: LocalApiConfig; onChange: (next: LocalApiConfig) => void }) {
    const { message } = App.useApp();
    const [baseUrl, setBaseUrl] = useState(config.baseUrl);
    const [apiKey, setApiKey] = useState("");
    const [models, setModels] = useState(config.models);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setBaseUrl(config.baseUrl);
        setModels(config.models);
    }, [config.baseUrl, config.models]);
    const label = API_LABELS[capability];
    const save = async () => {
        setSaving(true);
        try {
            const next = await updateLocalApiSetting(capability, { baseUrl, apiKey, models });
            setApiKey("");
            onChange(next);
            message.success(`${label} API 已保存`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : `${label} API 保存失败`);
        } finally {
            setSaving(false);
        }
    };
    const clear = async () => {
        setSaving(true);
        try {
            const next = await updateLocalApiSetting(capability, { clear: true });
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
        <section className="min-w-0 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <KeyRound className="size-4" />
                    {label} API
                    <Tag color={config.configured ? "green" : "default"}>{config.configured ? `已配置 · ${config.apiKeyFingerprint}` : "未配置"}</Tag>
                </div>
                {config.updatedAt ? <span className="text-xs text-stone-500">更新于 {new Date(config.updatedAt).toLocaleString()}</span> : null}
            </div>
            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1.2fr]">
                <Input className="min-w-0" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" addonBefore="Base URL" />
                <Input.Password className="min-w-0" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.configured ? "留空保留现有密钥" : "输入 API Key"} addonBefore="API Key" />
                <Select className="min-w-0" mode="tags" value={models} onChange={setModels} placeholder="模型名称" tokenSeparators={[","]} maxTagCount="responsive" />
            </div>
            <div className="mt-3 flex justify-end gap-2">
                <Button danger icon={<Trash2 className="size-4" />} disabled={!config.configured || saving} onClick={() => void clear()}>
                    清除
                </Button>
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!baseUrl.trim() || (!config.configured && apiKey.trim().length < 8)} onClick={() => void save()}>
                    保存
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

function unique(values: string[]) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeImageCount(value: string) {
    const count = Number.parseInt(value, 10);
    return String(Number.isFinite(count) ? Math.max(1, Math.min(15, count)) : 1);
}
