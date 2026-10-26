import type { LocalApiSettings } from "@/services/backend-api-status";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { APP_API_PROXY_PREFIX, APP_BASE_URL } from "@/config/app-config";

export type ApiCallFormat = "openai" | "gemini";

export type ModelChannel = {
    textProtocol?: "chat" | "responses";
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

export type DefaultModels = Pick<AiConfig, "imageModel" | "textModel" | "videoModel" | "audioModel">;

export type AiConfig = {
    textProtocol?: "chat" | "responses";
    defaultModelsRevision?: string;
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
    tinifyApiKey: string;
};

export type ConfigTabKey = "apis" | "models" | "preferences" | "diagnostics";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = APP_BASE_URL;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export const BACKEND_API_CHANNEL_ID = "backend";
export const BACKEND_API_BASE_URL = "/api/ai";
export const BACKEND_API_KEY_PLACEHOLDER = "backend-managed";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: BACKEND_API_BASE_URL,
    apiKey: BACKEND_API_KEY_PLACEHOLDER,
    apiFormat: "openai",
    channels: [
        {
            id: BACKEND_API_CHANNEL_ID,
            name: "本地 API",
            baseUrl: BACKEND_API_BASE_URL,
            apiKey: BACKEND_API_KEY_PLACEHOLDER,
            apiFormat: "openai",
            models: [],
        },
    ],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "low",
    size: "1:1",
    count: "1",
    canvasImageCount: "1",
    tinifyApiKey: "",
};

type ConfigStore = {
    config: AiConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    saveDefaultModels: (models: DefaultModels) => void;
    syncApiModels: (settings: LocalApiSettings) => void;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo");
}

function isImageModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return (
        !isVideoModelName(model) &&
        !isAudioModelName(model) &&
        (value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("image") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("flux") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney"))
    );
}

function isAudioModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.models.includes(modelOptionName(model)) && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            isConfigOpen: false,
            configTab: "apis",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                        ...(key === "imageModel" ? { model: value as string } : {}),
                    },
                })),
            saveDefaultModels: (models) => {
                const current = get().config;
                for (const capability of ["image", "text", "video", "audio"] as const) {
                    const value = models[`${capability}Model`];
                    if (value && !selectableModelsByCapability(current, capability).includes(value)) throw new Error("所选模型已不可用，请刷新列表后重新选择。");
                }
                set({ config: { ...current, ...models, model: models.imageModel, defaultModelsRevision: nanoid() } });
            },
            syncApiModels: (settings) =>
                set((state) => {
                    const capabilities = ["image", "text", "video", "audio"] as const;
                    const channels = Object.entries(settings).flatMap(([capability, group]) =>
                        capability === "tinify"
                            ? []
                            : (group.channels || [{ ...group, id: `${capability}-default` }]).map((item) =>
                                  createModelChannel({
                                      id: item.id || `${capability}-default`,
                                      name: item.name,
                                      baseUrl: `${BACKEND_API_BASE_URL}/channels/${item.id || `${capability}-default`}`,
                                      apiKey: BACKEND_API_KEY_PLACEHOLDER,
                                      apiFormat: item.apiFormat,
                                      textProtocol: item.textProtocol || "responses",
                                      models: item.models,
                                  }),
                              ),
                    );
                    // Keep legacy node references bound to the original default slots only.
                    channels.push(
                        createModelChannel({ id: BACKEND_API_CHANNEL_ID, name: "原默认渠道", baseUrl: BACKEND_API_BASE_URL, apiKey: BACKEND_API_KEY_PLACEHOLDER, models: uniqueRawModels(Object.values(settings).flatMap((group) => group.models)) }),
                    );
                    const next = { ...state.config, channels, models: modelOptionsFromChannels(channels.filter((channel) => channel.id !== BACKEND_API_CHANNEL_ID)) };
                    for (const capability of capabilities) {
                        const group = settings[capability];
                        if (!group) {
                            next[`${capability}Models`] = [];
                            continue;
                        }
                        next[`${capability}Models`] = (group.channels || [{ ...group, id: `${capability}-default` }]).flatMap((item) => item.models.map((id) => encodeChannelModel(item.id || `${capability}-default`, id)));
                        const saved = state.config[`${capability}Model`];
                        if (decodeChannelModel(saved)?.channelId === BACKEND_API_CHANNEL_ID) next[`${capability}Model`] = encodeChannelModel(`${capability}-default`, modelOptionName(saved));
                    }
                    next.model = next.imageModel;
                    return { config: next };
                }),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "apis") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            version: 1,
            migrate: (persistedState) => {
                const state = (persistedState || {}) as { config?: Partial<AiConfig> };
                const persistedConfig = state.config || {};
                return {
                    ...state,
                    config: {
                        ...persistedConfig,
                        // Migrate the former default during the version bump.
                        ...(persistedConfig.canvasImageCount === "3" ? { canvasImageCount: "1" } : {}),
                    },
                };
            },
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeBackendManagedChannels(normalizeChannels(config));
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels) || config.imageModel || config.model,
                        videoModel: normalizeModelOptionValue(config.videoModel, channels) || config.videoModel,
                        textModel: normalizeModelOptionValue(config.textModel, channels) || config.textModel,
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels) || config.audioModel || defaultConfig.audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "1",
                        tinifyApiKey: config.tinifyApiKey || "",
                        imageModels: Array.isArray(persistedConfig.imageModels) ? normalizeModelList(config.imageModels, channels) : filterModelsByCapability(models, "image"),
                        videoModels: Array.isArray(persistedConfig.videoModels) ? normalizeModelList(config.videoModels, channels) : filterModelsByCapability(models, "video"),
                        textModels: Array.isArray(persistedConfig.textModels) ? normalizeModelList(config.textModels, channels) : filterModelsByCapability(models, "text"),
                        audioModels: Array.isArray(persistedConfig.audioModels) ? normalizeModelList(config.audioModels, channels) : filterModelsByCapability(models, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[], channels: ModelChannel[]) {
    const allModelOptions = channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model)));
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)))
        .map((model) => normalizeModelOptionValue(model, channels))
        .filter((model) => !allModelOptions.length || allModelOptions.includes(model) || !isChannelModelValue(model));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        textProtocol: channel?.textProtocol || "responses",
        models: uniqueRawModels(channel?.models || []),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${channel.name} / ${decoded.model}` : `${decoded.model}（渠道不可用）`;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.includes(decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.includes(model)) || channels[0];
    return channel && channel.models.includes(model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.includes(model));
    if (decoded && !matched) return createModelChannel({ id: decoded.channelId, name: "渠道不可用", baseUrl: BACKEND_API_BASE_URL, models: [], apiKey: "" });
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string, allowUnavailable = false) {
    const channel = resolveModelChannel(config, value);
    if (!channel.apiKey || !value || (!allowUnavailable && !channel.models.includes(modelOptionName(value)))) throw new Error("请在设置中获取上游模型并重新选择模型");
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        textProtocol: channel.textProtocol,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: uniqueRawModels(channel.models || []),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: BACKEND_API_BASE_URL,
                apiKey: BACKEND_API_KEY_PLACEHOLDER,
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: uniqueRawModels([...(config.models || []), config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel]),
            }),
        );
    }
    return channels.map((channel) => ({ ...channel, models: uniqueRawModels(channel.models) }));
}

function normalizeBackendManagedChannels(channels: ModelChannel[]) {
    return channels.map((channel) =>
        createModelChannel({
            ...channel,
            baseUrl: channel.id === BACKEND_API_CHANNEL_ID ? BACKEND_API_BASE_URL : `${BACKEND_API_BASE_URL}/channels/${encodeURIComponent(channel.id)}`,
            apiKey: BACKEND_API_KEY_PLACEHOLDER,
        }),
    );
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? "gemini" : "openai";
}

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map((model) => modelOptionName(model).trim()).filter(Boolean)));
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (normalizedBaseUrl.startsWith("/")) return `${normalizedBaseUrl}${normalizedBaseUrl.endsWith("/v1") ? "" : "/v1"}${path}`;
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    if (shouldUseProviderProxy(apiBaseUrl)) return `${APP_API_PROXY_PREFIX}${path}`;
    return `${apiBaseUrl}${path}`;
}

function shouldUseProviderProxy(apiBaseUrl: string) {
    if (typeof window === "undefined") return false;
    const providerApiBaseUrl = APP_BASE_URL.replace(/\/+$/, "")
        .replace(/(?:\/v1)?$/, "/v1")
        .toLowerCase();
    return apiBaseUrl.toLowerCase() === providerApiBaseUrl;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}

// A global save supersedes older per-node/session choices; later explicit choices remain local.
export function resolveConfiguredModel(config: AiConfig, capability: ModelCapability, localModel?: string, revision?: string) {
    if (localModel && (!config.defaultModelsRevision || revision === config.defaultModelsRevision)) {
        return decodeChannelModel(localModel)?.channelId === BACKEND_API_CHANNEL_ID && config.channels.some((channel) => channel.id === `${capability}-default`) ? encodeChannelModel(`${capability}-default`, modelOptionName(localModel)) : localModel;
    }
    return config[`${capability}Model`];
}
