import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readDb, updateDb } from "./store.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const secretPath = process.env.CANVAS_SECRET_PATH ? resolve(process.env.CANVAS_SECRET_PATH) : resolve(serverDir, "data/backend-api-secret.key");
export const DEFAULT_BASE_URL = "https://api.example.com";
const CAPABILITIES = new Set(["image", "text", "video", "audio", "music"]);
const DEFAULTS = {
    image: { name: "图片 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: ["gpt-image-2", "gpt-5.5"] },
    text: { name: "文本 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: ["gpt-5.5"] },
    video: { name: "视频 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: ["grok-imagine-video"] },
    audio: { name: "音频 API", baseUrl: DEFAULT_BASE_URL, apiFormat: "openai", models: ["gpt-4o-mini-tts"] },
    music: { name: "音乐 API", baseUrl: "https://api.elevenlabs.io", apiFormat: "openai", models: ["music_v2"] },
};

export async function listLocalApiSettings() {
    const db = await readDb();
    return Object.fromEntries([...CAPABILITIES].map((capability) => [capability, publicApiConfig(db.apiConfigs?.[capability], capability)]));
}

export async function updateLocalApiSetting(capability, input = {}) {
    const normalizedCapability = normalizeCapability(capability);
    const db = await readDb();
    const current = db.apiConfigs?.[normalizedCapability];
    if (input.clear === true) {
        return updateDb((nextDb) => {
            delete nextDb.apiConfigs[normalizedCapability];
            return publicApiConfig(null, normalizedCapability);
        });
    }

    const apiKey = String(input.apiKey || "").trim();
    if (!apiKey && !current?.encryptedApiKey) throw badRequest("请填写 API Key");
    const next = {
        name: String(input.name || current?.name || DEFAULTS[normalizedCapability].name)
            .trim()
            .slice(0, 80),
        baseUrl: normalizeBaseUrl(input.baseUrl === undefined ? current?.baseUrl || DEFAULTS[normalizedCapability].baseUrl : input.baseUrl),
        apiFormat: input.apiFormat === undefined ? current?.apiFormat || "openai" : input.apiFormat === "gemini" ? "gemini" : "openai",
        encryptedApiKey: apiKey ? await encryptSecret(normalizeApiKey(apiKey)) : current.encryptedApiKey,
        apiKeyHash: apiKey ? hashSecret(apiKey) : current.apiKeyHash,
        models: normalizeModels(input.models === undefined ? current?.models || DEFAULTS[normalizedCapability].models : input.models),
        updatedAt: new Date().toISOString(),
    };
    return updateDb((nextDb) => {
        nextDb.apiConfigs[normalizedCapability] = next;
        return publicApiConfig(next, normalizedCapability);
    });
}

export async function getBackendApiConfigForUser(_workspace, options = {}) {
    return getBackendApiConfigForCapability(options.capability || (options.imageOperation ? "image" : "audio"));
}

export async function getBackendApiConfigForCapability(capability) {
    const normalizedCapability = normalizeCapability(capability);
    const db = await readDb();
    const config = db.apiConfigs?.[normalizedCapability];
    if (!config?.encryptedApiKey) return null;
    return { ...config, apiKey: await decryptSecret(config.encryptedApiKey), capability: normalizedCapability, source: "local" };
}

export function publicApiConfig(config, capability) {
    const normalizedCapability = normalizeCapability(capability);
    const defaults = DEFAULTS[normalizedCapability];
    return {
        capability: normalizedCapability,
        configured: Boolean(config?.encryptedApiKey),
        name: config?.name || defaults.name,
        baseUrl: config?.baseUrl || defaults.baseUrl,
        apiFormat: config?.apiFormat || defaults.apiFormat,
        apiKeyFingerprint: config?.apiKeyHash ? config.apiKeyHash.slice(0, 12) : "",
        models: normalizeModels(config?.models || defaults.models),
        updatedAt: config?.updatedAt || "",
    };
}

function normalizeCapability(value) {
    const capability = String(value || "")
        .trim()
        .toLowerCase();
    if (!CAPABILITIES.has(capability)) throw badRequest("不支持的 API 类型");
    return capability;
}

function normalizeModels(models) {
    return Array.from(new Set((Array.isArray(models) ? models : String(models || "").split(",")).map((model) => String(model).trim()).filter(Boolean))).slice(0, 100);
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
