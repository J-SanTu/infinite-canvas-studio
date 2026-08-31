import { randomUUID } from "node:crypto";

import { readDb } from "./store.js";
import {
    appendImageUsageOutbox,
    countImageUsageEvents,
    flushImageUsageOutbox,
    initializeImageUsageRepository,
    insertImageUsageEvent,
    listImageUsageEvents as listRepositoryEvents,
    summarizeImageUsage as summarizeRepositoryUsage,
} from "./image-usage-repository.js";

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const imageRequestSlots = new Map();
const DEFAULT_IMAGE_API_CONCURRENCY = normalizeConcurrencyLimit(process.env.CANVAS_IMAGE_API_CONCURRENCY || 3);
const accountingPendingUsers = new Map();
let repositoryReadyPromise;

export function imageOperationFromPath(pathname, operationHeader) {
    if (operationHeader === "generation" || operationHeader === "edit") return operationHeader;
    const cleanPath = String(pathname || "")
        .split("?", 1)[0]
        .replace(/\/+$/, "");
    if (cleanPath.endsWith("/images/generations")) return "generation";
    if (cleanPath.endsWith("/images/edits")) return "edit";
    return null;
}

export async function withImageUsageSlot(slotKey, task, limit = DEFAULT_IMAGE_API_CONCURRENCY) {
    const key = String(slotKey || "default");
    const state = imageRequestSlots.get(key) || { active: 0, queue: [] };
    imageRequestSlots.set(key, state);
    if (state.active >= limit) {
        await new Promise((resolve) => state.queue.push(resolve));
    }
    state.active += 1;
    try {
        return await task();
    } finally {
        state.active = Math.max(0, state.active - 1);
        const next = state.queue.shift();
        if (next) next();
        else if (state.active === 0) imageRequestSlots.delete(key);
    }
}

export async function assertImageTokenAvailable(userId, now = new Date()) {
    await ensureImageUsageRepository();
    await recoverPendingAccounting(userId);
    return { userId, checkedAt: now.toISOString() };
}

export async function recordImageUsage({ userId, operation, usage, imageCount, qualityTier, requestId, model, createdAt, legacyUncounted = false }) {
    await ensureImageUsageRepository();
    const normalizedUsage = normalizeUpstreamUsage(usage);
    const safeRequestId = normalizeRequestId(requestId);
    const event = {
        id: `image_usage_${randomUUID()}`,
        requestId: safeRequestId,
        userId,
        operation: operation === "edit" ? "edit" : "generation",
        model: String(model || ""),
        totalTokens: normalizedUsage.totalTokens,
        inputTokens: normalizedUsage.inputTokens,
        outputTokens: normalizedUsage.outputTokens,
        reported: normalizedUsage.reported,
        imageCount: nonNegativeInteger(imageCount),
        qualityTier: normalizeImageQualityTier(qualityTier),
        legacyUncounted: legacyUncounted === true,
        createdAt: createdAt || new Date().toISOString(),
    };
    const inserted = insertImageUsageEvent(event);
    return { inserted, event };
}

export async function recordImageUsageSafely(input) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const result = await recordImageUsage(input);
            return { status: result.inserted ? "recorded" : "duplicate", event: result.event };
        } catch (error) {
            lastError = error;
            if (attempt === 0) await delay(30);
        }
    }

    const normalizedUsage = normalizeUpstreamUsage(input.usage);
    const event = {
        id: `image_usage_${randomUUID()}`,
        requestId: normalizeRequestId(input.requestId),
        userId: input.userId,
        operation: input.operation === "edit" ? "edit" : "generation",
        model: String(input.model || ""),
        totalTokens: normalizedUsage.totalTokens,
        inputTokens: normalizedUsage.inputTokens,
        outputTokens: normalizedUsage.outputTokens,
        reported: normalizedUsage.reported,
        imageCount: nonNegativeInteger(input.imageCount),
        qualityTier: normalizeImageQualityTier(input.qualityTier),
        legacyUncounted: false,
        createdAt: new Date().toISOString(),
    };
    try {
        await appendImageUsageOutbox(event);
        accountingPendingUsers.set(input.userId, "queued");
        console.error(`Image usage accounting queued for retry: ${event.requestId}: ${formatError(lastError)}`);
        return { status: "queued", event };
    } catch (outboxError) {
        accountingPendingUsers.set(input.userId, "untracked");
        console.error(`Image usage accounting could not be persisted: ${event.requestId}: ${formatError(outboxError)}`);
        return { status: "untracked", event, error: outboxError };
    }
}

export async function getImageUsageSummary(filters = {}) {
    await ensureImageUsageRepository();
    return summarizeRepositoryUsage(filters);
}

export async function getImageUsageSnapshot(user, filters = {}, now = new Date()) {
    await ensureImageUsageRepository();
    const billingPeriod = getImageBillingPeriod(user.imageQuotaResetDay, now);
    return {
        filtered: summarizeRepositoryUsage({ userId: user.id, from: filters.from, to: filters.to }),
        allTime: summarizeRepositoryUsage({ userId: user.id }),
        period: summarizeRepositoryUsage({ userId: user.id, from: billingPeriod.startsAt, to: billingPeriod.resetsAt }),
        billingPeriod,
    };
}

export async function listImageUsageEvents(filters = {}) {
    await ensureImageUsageRepository();
    return { events: listRepositoryEvents(filters), total: countImageUsageEvents(filters) };
}

export async function retryPendingImageUsage() {
    await ensureImageUsageRepository();
    const result = await flushImageUsageOutbox();
    if (result.remaining === 0) {
        for (const [userId, status] of accountingPendingUsers) {
            if (status === "queued") accountingPendingUsers.delete(userId);
        }
    }
    return result;
}

export function getImageBillingPeriod(resetDayValue = 1, now = new Date()) {
    const resetDay = normalizeResetDay(resetDayValue);
    const local = new Date(now.getTime() + CHINA_OFFSET_MS);
    let year = local.getUTCFullYear();
    let month = local.getUTCMonth();
    if (local.getUTCDate() < resetDay) {
        month -= 1;
        if (month < 0) {
            month = 11;
            year -= 1;
        }
    }
    const startsAtMs = Date.UTC(year, month, resetDay) - CHINA_OFFSET_MS;
    const resetsAtMs = Date.UTC(year, month + 1, resetDay) - CHINA_OFFSET_MS;
    return { resetDay, startsAt: new Date(startsAtMs).toISOString(), resetsAt: new Date(resetsAtMs).toISOString() };
}

export function normalizeImageTokenLimit(value) {
    if (value === null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
        const error = new Error("图片 token 上限必须是非负整数或 null");
        error.statusCode = 400;
        throw error;
    }
    return number;
}

export function normalizeResetDay(value) {
    const number = Number(value ?? 1);
    if (!Number.isInteger(number) || number < 1 || number > 28) {
        const error = new Error("额度重置日必须是 1 到 28 之间的整数");
        error.statusCode = 400;
        throw error;
    }
    return number;
}

export function normalizeStoredLimit(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

export function readImageUsageFromPayload(payload) {
    if (!payload || typeof payload !== "object") return undefined;
    if (payload.usage && typeof payload.usage === "object") return payload.usage;
    if (payload.usageMetadata && typeof payload.usageMetadata === "object") {
        return {
            total_tokens: payload.usageMetadata.totalTokenCount,
            input_tokens: payload.usageMetadata.promptTokenCount,
            output_tokens: payload.usageMetadata.candidatesTokenCount,
        };
    }
    return undefined;
}

export function readImageOutputCount(payload) {
    if (!payload || typeof payload !== "object") return 0;
    if (Array.isArray(payload.data)) return payload.data.length;
    if (!Array.isArray(payload.candidates)) return 0;
    return payload.candidates.reduce((count, candidate) => count + (candidate?.content?.parts || []).filter((part) => part?.inlineData?.data || part?.inline_data?.data || part?.fileData?.fileUri).length, 0);
}

export async function readImageRequestMetadata(body, contentType, hints = {}) {
    let quality = hints.quality;
    let model = hints.model;
    let requestedCount = hints.requestedCount;
    if ((!quality || !model || !requestedCount) && body) {
        const type = String(contentType || "").toLowerCase();
        try {
            if (type.includes("application/json")) {
                const payload = JSON.parse(Buffer.from(body).toString("utf8"));
                quality ||= payload?.quality || payload?.generationConfig?.responseConfig?.imageConfig?.imageSize;
                model ||= payload?.model;
                requestedCount ||= payload?.n;
            } else if (type.includes("multipart/form-data")) {
                const formData = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
                quality ||= formData.get("quality");
                model ||= formData.get("model");
                requestedCount ||= formData.get("n");
            }
        } catch {
            // Missing metadata is surfaced as unclassified rather than failing generation.
        }
    }
    return { qualityTier: normalizeImageQualityTier(quality), model: String(model || ""), requestedCount: Math.max(1, nonNegativeInteger(requestedCount) || 1) };
}

export function normalizeImageQualityTier(value) {
    const quality = String(value || "")
        .trim()
        .toLowerCase();
    if (quality === "low" || quality === "standard" || quality === "1k") return "1K";
    if (quality === "medium" || quality === "hd" || quality === "2k") return "2K";
    if (quality === "high" || quality === "4k") return "4K";
    return null;
}

export function isSuccessfulImagePayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.error) return false;
    return payload.code === undefined || Number(payload.code) === 0;
}

async function ensureImageUsageRepository() {
    if (!repositoryReadyPromise) {
        repositoryReadyPromise = (async () => {
            const db = await readDb();
            initializeImageUsageRepository(db.imageUsageEvents);
            await flushImageUsageOutbox().catch((error) => console.error(`Image usage outbox retry failed: ${formatError(error)}`));
        })().catch((error) => {
            repositoryReadyPromise = undefined;
            throw error;
        });
    }
    return repositoryReadyPromise;
}

async function recoverPendingAccounting(userId) {
    const status = accountingPendingUsers.get(userId);
    if (!status) return;
    if (status === "queued") {
        const result = await retryPendingImageUsage().catch(() => ({ remaining: 1 }));
        if (result.remaining === 0) return;
    }
    const error = new Error("上一笔图片请求的用量记录尚未安全落库，请稍后重试。");
    error.statusCode = 503;
    throw error;
}

function normalizeUpstreamUsage(usage) {
    const reportedTotal = numericField(usage, "total_tokens", "totalTokens");
    return {
        totalTokens: reportedTotal === null ? 0 : nonNegativeInteger(reportedTotal),
        inputTokens: nonNegativeInteger(numericField(usage, "input_tokens", "inputTokens")),
        outputTokens: nonNegativeInteger(numericField(usage, "output_tokens", "outputTokens")),
        reported: reportedTotal !== null,
    };
}

function numericField(value, snakeCaseKey, camelCaseKey) {
    if (!value || typeof value !== "object") return null;
    const number = Number(value[snakeCaseKey] ?? value[camelCaseKey]);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeRequestId(value) {
    const requestId = String(value || "").trim();
    return /^[A-Za-z0-9_:.\-]{8,160}$/.test(requestId) ? requestId : `image_request_${randomUUID()}`;
}

function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function formatError(error) {
    return error instanceof Error ? error.message : String(error || "unknown error");
}

function normalizeConcurrencyLimit(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 3;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
