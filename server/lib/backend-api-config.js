import { registerLogSecret } from "./diagnostic-log.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readDb, updateDb, dbPath } from "./store.js";
import { discoverModels, inferModelCapability } from "./upstream-models.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const secretPath = process.env.CANVAS_SECRET_PATH ? resolve(process.env.CANVAS_SECRET_PATH) : resolve(serverDir, "data/backend-api-secret.key");
export const DEFAULT_BASE_URL = "https://tokenhub.holdwellgroup.com/v1";
const CAPABILITIES = new Set(["image", "text", "video", "audio", "music", "tinify"]);
const DEFAULTS = {
    tinify: { name: "Tinify 图片压缩", baseUrl: "https://api.tinify.com", apiFormat: "openai", models: [] },
    image: { name: "图片 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: [] },
    text: { name: "文本 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: [] },
    video: { name: "视频 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: [] },
    audio: { name: "音频 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: [] },
    music: { name: "音乐 API", baseUrl: "https://api.elevenlabs.io", apiFormat: "openai", models: [] },
};

export async function listLocalApiSettings() {
    const db = await readDb();
    return Object.fromEntries([...CAPABILITIES].map((capability) => [capability, publicApiGroup(db.apiConfigs?.[capability], capability)]));
}

const settingQueues = new Map();
export function updateLocalApiSetting(capability, input = {}) {
    const key = normalizeCapability(capability);
    const pending = (settingQueues.get(key) || Promise.resolve()).then(() => saveLocalApiSetting(key, input));
    settingQueues.set(
        key,
        pending.catch(() => undefined),
    );
    return pending;
}

async function saveLocalApiSetting(capability, input = {}) {
    const normalizedCapability = normalizeCapability(capability);
    const db = await readDb();
    const group = db.apiConfigs?.[normalizedCapability];
    const channelId = String(input.channelId || `${normalizedCapability}-default`);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(channelId)) throw badRequest("渠道 ID 无效");
    const isDefault = channelId === `${normalizedCapability}-default`;
    if (normalizedCapability === "tinify" && !isDefault) throw badRequest("Tinify 只支持单份配置");
    const current = isDefault ? group : group?.channels?.find((item) => item.id === channelId);
    if (!isDefault && !current && input.create !== true) throw badRequest("渠道已删除，请重新选择");
    if (input.create && (current?.encryptedApiKey || isDefault)) throw badRequest("渠道已存在");
    // Preserve the encrypted pre-upgrade settings once, alongside the same local key.
    if (input.channelId || input.create) await backupBeforeMultiApi(db);
    const persist = (next) =>
        updateDb((nextDb) => {
            const latest = nextDb.apiConfigs[normalizedCapability] || {};
            if (isDefault) nextDb.apiConfigs[normalizedCapability] = { ...(next || {}), channels: latest.channels || [] };
            else {
                const existing = latest.channels || [];
                const replacement = next ? { ...next, id: channelId } : null;
                const channels = existing.flatMap((item) => (item.id === channelId ? (replacement ? [replacement] : []) : [item]));
                if (replacement && !existing.some((item) => item.id === channelId)) channels.push(replacement);
                nextDb.apiConfigs[normalizedCapability] = { ...latest, channels };
            }
            return publicApiGroup(nextDb.apiConfigs[normalizedCapability], normalizedCapability);
        });
    if (input.clear === true) return persist(null);
    if (input.selectedModels !== undefined) {
        if (current?.modelsStatus !== "ready") throw badRequest("请先成功获取上游模型列表");
        const selected = normalizeModels(input.selectedModels);
        if (selected.some((id) => !current.availableModels.includes(id))) throw badRequest("只能选择上游返回的模型");
        return persist({ ...current, models: selected });
    }
    const apiKey = String(input.apiKey || "").trim();
    if (!apiKey && !current?.encryptedApiKey) throw badRequest("请填写 API Key");
    registerLogSecret(apiKey);
    const next = {
        name: String(input.name?.trim() || current?.name || (input.baseUrl ? new URL(normalizeBaseUrl(input.baseUrl)).hostname : DEFAULTS[normalizedCapability].name))
            .trim()
            .slice(0, 80),
        baseUrl: normalizedCapability === "tinify" ? DEFAULTS.tinify.baseUrl : normalizeBaseUrl(input.baseUrl === undefined ? current?.baseUrl || DEFAULTS[normalizedCapability].baseUrl : input.baseUrl),
        apiFormat: input.apiFormat === undefined ? current?.apiFormat || "openai" : input.apiFormat === "gemini" ? "gemini" : "openai",
        textProtocol: input.textProtocol === undefined ? current?.textProtocol || (input.create ? "chat" : "responses") : input.textProtocol === "chat" ? "chat" : "responses",
        encryptedApiKey: apiKey ? await encryptSecret(normalizeApiKey(apiKey)) : current.encryptedApiKey,
        apiKeyHash: apiKey ? hashSecret(apiKey) : current.apiKeyHash,
        models: [],
        availableModels: [],
        modelsStatus: normalizedCapability === "tinify" ? "not_required" : "error",
        modelsError: "",
        modelsFetchedAt: "",
        updatedAt: new Date().toISOString(),
    };
    const sameSource = current?.baseUrl === next.baseUrl && current?.apiKeyHash === next.apiKeyHash && current?.apiFormat === next.apiFormat && (current?.textProtocol || "responses") === next.textProtocol;
    if (sameSource) {
        next.models = current.models || [];
        next.availableModels = current.availableModels || [];
        next.modelsFetchedAt = current.modelsFetchedAt || "";
    }
    if (normalizedCapability !== "tinify") {
        try {
            const secret = apiKey || (await decryptSecret(current.encryptedApiKey));
            registerLogSecret(secret);
            next.availableModels = await discoverModels({ ...next, apiKey: secret, capability: normalizedCapability });
            next.models = sameSource && (current?.modelsStatus === "ready" || (current?.modelsStatus === "error" && Boolean(current?.modelsFetchedAt))) ? current.models.filter((id) => next.availableModels.includes(id)) : next.availableModels.filter((id) => inferModelCapability(id) === normalizedCapability);
            // Newly available models become selectable; defaults are selected explicitly in the UI.
            // Refresh preserves explicit selections; newly discovered models remain available to select.
            next.modelsStatus = "ready";
            next.modelsFetchedAt = new Date().toISOString();
        } catch (error) {
            next.modelsError = error?.message?.startsWith("上游") ? error.message : "连接上游或读取模型失败，请检查地址、密钥及网络后刷新";
        }
    }
    return persist(next);
}

export async function getBackendApiConfigForUser(_workspace, options = {}) {
    return getBackendApiConfigForCapability(options.capability || (options.imageOperation ? "image" : "audio"), options.channelId);
}

export async function getBackendApiConfigForCapability(capability, channelId) {
    const normalizedCapability = normalizeCapability(capability);
    const db = await readDb();
    const group = db.apiConfigs?.[normalizedCapability];
    const config = !channelId || channelId === `${normalizedCapability}-default` ? group : group?.channels?.find((item) => item.id === channelId);
    if (!config?.encryptedApiKey) return null;
    const apiKey = await decryptSecret(config.encryptedApiKey);
    registerLogSecret(apiKey);
    return { ...config, apiKey, capability: normalizedCapability, source: "local" };
}

export function publicApiConfig(config, capability) {
    const normalizedCapability = normalizeCapability(capability);
    const defaults = DEFAULTS[normalizedCapability];
    return {
        id: config?.id || `${normalizedCapability}-default`,
        textProtocol: config?.textProtocol || "responses",
        capability: normalizedCapability,
        configured: Boolean(config?.encryptedApiKey),
        name: config?.name || defaults.name,
        baseUrl: config?.baseUrl || defaults.baseUrl,
        apiFormat: config?.apiFormat || defaults.apiFormat,
        apiKeyFingerprint: config?.apiKeyHash ? config.apiKeyHash.slice(0, 12) : "",
        models: config?.modelsStatus === "ready" || (config?.modelsStatus === "error" && config?.modelsFetchedAt) ? normalizeModels(config?.models) : [],
        availableModels: config?.modelsStatus === "ready" || (config?.modelsStatus === "error" && config?.modelsFetchedAt) ? normalizeModels(config?.availableModels) : [],
        modelsStatus: normalizedCapability === "tinify" ? "not_required" : config?.modelsStatus || "unverified",
        modelsError: config?.modelsError || "",
        modelsFetchedAt: config?.modelsFetchedAt || "",
        updatedAt: config?.updatedAt || "",
    };
}

function publicApiGroup(group, capability) {
    const base = publicApiConfig(group, capability);
    return { ...base, channels: [...(group?.encryptedApiKey ? [base] : []), ...(group?.channels || []).map((channel) => publicApiConfig(channel, capability))] };
}

async function backupBeforeMultiApi(db) {
    await mkdir(dirname(dbPath), { recursive: true });
    try {
        await writeFile(`${dbPath}.pre-multi-api.bak`, JSON.stringify(db, null, 2), { flag: "wx", mode: 0o600 });
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
    }
}

function normalizeCapability(value) {
    const capability = String(value || "")
        .trim()
        .toLowerCase();
    if (!CAPABILITIES.has(capability)) throw badRequest("不支持的 API 类型");
    return capability;
}

function normalizeModels(models) {
    return Array.from(new Set((Array.isArray(models) ? models : String(models || "").split(",")).map((model) => String(model).trim()).filter(Boolean)));
}

function normalizeApiKey(apiKey) {
    const value = String(apiKey || "").trim();
    if (value.length < 8) throw badRequest("API Key 至少需要 8 位");
    if (/^https?:\/\//i.test(value)) throw badRequest("API Key 不能填写 URL，请填写令牌值");
    return value;
}

function normalizeBaseUrl(baseUrl) {
    const value = String(baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
    let url;
    try {
        url = new URL(value);
    } catch {
        throw badRequest("Base URL 必须是有效的 HTTP(S) 地址");
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw badRequest("Base URL 必须是有效的 HTTP(S) 地址");
    return value;
}

function hashSecret(value) {
    return createHash("sha256").update(value).digest("hex");
}

async function encryptSecret(value) {
    const key = await readOrCreateSecretKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `aes-256-gcm:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

async function decryptSecret(value) {
    const [method, ivBase64, tagBase64, encryptedBase64] = String(value || "").split(":");
    if (method !== "aes-256-gcm" || !ivBase64 || !tagBase64 || !encryptedBase64) throw new Error("本地 API Key 配置损坏");
    const key = await readOrCreateSecretKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivBase64, "base64"));
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedBase64, "base64")), decipher.final()]).toString("utf8");
}

async function readOrCreateSecretKey() {
    try {
        const raw = await readFile(secretPath, "utf8");
        const key = Buffer.from(raw.trim(), "base64");
        if (key.length === 32) return key;
    } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
    }
    const key = randomBytes(32);
    await mkdir(dirname(secretPath), { recursive: true });
    await writeFile(secretPath, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
    return key;
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}
