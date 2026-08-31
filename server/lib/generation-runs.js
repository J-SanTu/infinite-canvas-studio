import { randomUUID } from "node:crypto";

import { createId, readDb, updateDb } from "./store.js";

export const GENERATION_RUN_STATUSES = ["draft", "queued", "running", "succeeded", "retryable_failed", "failed", "canceled"];
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const RETRYABLE_ERRORS = new Set(["network_error", "upstream_408", "upstream_429", "upstream_500", "upstream_502", "upstream_503", "upstream_504", "timeout"]);

const STATUS_TRANSITIONS = {
    draft: new Set(["queued", "canceled"]),
    queued: new Set(["running", "canceled", "retryable_failed", "failed"]),
    running: new Set(["succeeded", "canceled", "retryable_failed", "failed"]),
    retryable_failed: new Set(["queued", "canceled"]),
    succeeded: new Set(),
    failed: new Set(),
    canceled: new Set(),
};

export function normalizeCapability(value) {
    const capability = String(value || "image")
        .trim()
        .toLowerCase();
    return ["image", "video", "audio", "music", "text", "director"].includes(capability) ? capability : "image";
}

export function normalizeRunStatus(value, fallback = "queued") {
    const status = String(value || fallback)
        .trim()
        .toLowerCase();
    if (!GENERATION_RUN_STATUSES.includes(status)) throw badRequest(`不支持的任务状态: ${status}`);
    return status;
}

export async function createGenerationRun(userId, input = {}) {
    return updateDb((db) => createGenerationRunRecord(db, userId, input));
}

export function createGenerationRunRecord(db, userId, input = {}) {
    const requestId = normalizeRequestId(input.requestId);
    const now = new Date().toISOString();
    const duplicate = db.generationRuns.find((run) => run.userId === userId && run.requestId === requestId);
    if (duplicate) return { ...publicGenerationRun(duplicate), created: false };
    assertOwnedProject(db, userId, input.projectId);
    const outputAssetIds = assertOwnedAssets(db, userId, input.outputAssetIds);
    const status = normalizeRunStatus(input.status, "queued");
    const run = {
        id: createId("run"),
        userId,
        projectId: cleanOptionalId(input.projectId),
        targetNodeId: cleanOptionalId(input.targetNodeId),
        sourceNodeIds: normalizeStringArray(input.sourceNodeIds),
        operation: String(input.operation || "generation").trim() || "generation",
        capability: normalizeCapability(input.capability),
        modelId: String(input.modelId || input.model || "").trim(),
        providerId: String(input.providerId || "").trim(),
        requestId,
        upstreamRequestId: String(input.upstreamRequestId || "").trim(),
        inputSnapshot: normalizeJsonObject(input.inputSnapshot),
        parameterSnapshot: normalizeJsonObject(input.parameterSnapshot),
        status,
        attempt: Math.max(1, Number(input.attempt) || 1),
        parentRunId: cleanOptionalId(input.parentRunId),
        outputAssetIds,
        usageEventId: cleanOptionalId(input.usageEventId),
        errorCode: String(input.errorCode || "").trim(),
        errorMessageSafe: String(input.errorMessageSafe || "")
            .trim()
            .slice(0, 500),
        createdAt: now,
        startedAt: input.startedAt || (["running", "succeeded"].includes(status) ? now : ""),
        finishedAt: input.finishedAt || (TERMINAL_STATUSES.has(status) ? now : ""),
        updatedAt: now,
    };
    db.generationRuns.push(run);
    return { ...publicGenerationRun(run), created: true };
}

export async function getGenerationRun(userId, runId) {
    const db = await readDb();
    const run = db.generationRuns.find((item) => item.id === runId && item.userId === userId);
    if (!run) throw notFound("任务不存在");
    return publicGenerationRun(run);
}

export async function listGenerationRuns(userId, filters = {}) {
    const db = await readDb();
    const limit = Math.max(1, Math.min(100, Number(filters.limit) || 50));
    const status = filters.status ? normalizeRunStatus(filters.status) : "";
    const capability = filters.capability ? normalizeCapability(filters.capability) : "";
    const projectId = cleanOptionalId(filters.projectId);
    const keyword = String(filters.keyword || "")
        .trim()
        .toLowerCase();
    const sorted = db.generationRuns
        .filter((run) => run.userId === userId)
        .filter((run) => !status || run.status === status)
        .filter((run) => !capability || run.capability === capability)
        .filter((run) => !projectId || run.projectId === projectId)
        .filter((run) => !keyword || `${run.operation} ${run.modelId} ${run.errorCode}`.toLowerCase().includes(keyword))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const offset = Math.max(0, Number(filters.cursor) || 0);
    const page = sorted.slice(offset, offset + limit);
    return { runs: page.map(publicGenerationRun), total: sorted.length, nextCursor: offset + page.length < sorted.length ? String(offset + page.length) : null };
}

export async function transitionGenerationRun(userId, runId, nextStatus, patch = {}) {
    const status = normalizeRunStatus(nextStatus);
    const now = new Date().toISOString();
    return updateDb((db) => {
        const run = db.generationRuns.find((item) => item.id === runId && item.userId === userId);
        if (!run) throw notFound("任务不存在");
        if (run.status !== status && !STATUS_TRANSITIONS[run.status]?.has(status)) {
            throw conflict(`任务不能从 ${run.status} 变更为 ${status}`);
        }
        run.status = status;
        run.updatedAt = now;
        if (status === "running" && !run.startedAt) run.startedAt = now;
        if (TERMINAL_STATUSES.has(status) || status === "retryable_failed") run.finishedAt = now;
        if (patch.upstreamRequestId !== undefined) run.upstreamRequestId = String(patch.upstreamRequestId || "");
        if (patch.outputAssetIds !== undefined) run.outputAssetIds = assertOwnedAssets(db, userId, patch.outputAssetIds);
        if (patch.usageEventId !== undefined) run.usageEventId = cleanOptionalId(patch.usageEventId);
        if (patch.errorCode !== undefined) run.errorCode = String(patch.errorCode || "").trim();
        if (patch.errorMessageSafe !== undefined)
            run.errorMessageSafe = String(patch.errorMessageSafe || "")
                .trim()
                .slice(0, 500);
        return publicGenerationRun(run);
    });
}

export async function retryGenerationRun(userId, runId) {
    const original = await getGenerationRun(userId, runId);
    if (original.status !== "retryable_failed" && original.status !== "failed") throw conflict("只有失败任务可以重试");
    return createGenerationRun(userId, {
        ...original,
        requestId: `retry_${randomUUID()}`,
        status: "queued",
        attempt: original.attempt + 1,
        parentRunId: original.parentRunId || original.id,
        errorCode: "",
        errorMessageSafe: "",
        outputAssetIds: [],
        usageEventId: "",
        startedAt: "",
        finishedAt: "",
    });
}

export function publicGenerationRun(run) {
    return {
        id: run.id,
        userId: run.userId,
        projectId: run.projectId || null,
        targetNodeId: run.targetNodeId || null,
        sourceNodeIds: run.sourceNodeIds || [],
        operation: run.operation,
        capability: run.capability,
        modelId: run.modelId,
        providerId: run.providerId,
        requestId: run.requestId,
        upstreamRequestId: run.upstreamRequestId || null,
        inputSnapshot: run.inputSnapshot || {},
        parameterSnapshot: run.parameterSnapshot || {},
        status: run.status,
        attempt: run.attempt || 1,
        parentRunId: run.parentRunId || null,
        outputAssetIds: run.outputAssetIds || [],
        usageEventId: run.usageEventId || null,
        errorCode: run.errorCode || null,
        errorMessageSafe: run.errorMessageSafe || null,
        createdAt: run.createdAt,
        startedAt: run.startedAt || null,
        finishedAt: run.finishedAt || null,
        updatedAt: run.updatedAt || run.createdAt,
    };
}

function normalizeRequestId(value) {
    const requestId = String(value || "").trim();
    return /^[A-Za-z0-9_:.-]{8,160}$/.test(requestId) ? requestId : `run_request_${randomUUID()}`;
}

function normalizeStringArray(value) {
    return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 200);
}

function normalizeJsonObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function assertOwnedProject(db, userId, projectId) {
    const id = cleanOptionalId(projectId);
    if (!id) return;
    const owned = db.canvasProjects.some((project) => project.userId === userId && (project.id === id || project.localProjectId === id) && !project.deletedAt);
    if (!owned) throw forbidden("任务引用的画布项目不属于本地工作区");
}

function assertOwnedAssets(db, userId, value) {
    const ids = normalizeStringArray(value);
    if (!ids.length) return [];
    const owned = new Set(db.assets.filter((asset) => asset.userId === userId).flatMap((asset) => [asset.id, asset.localAssetId].filter(Boolean)));
    if (ids.some((id) => !owned.has(id))) throw forbidden("任务引用的输出素材不属于本地工作区");
    return ids;
}

function cleanOptionalId(value) {
    const id = String(value || "").trim();
    return id ? id.slice(0, 160) : null;
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function conflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

function notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
}

function forbidden(message) {
    const error = new Error(message);
    error.statusCode = 403;
    return error;
}

export function classifyUpstreamFailure(status, error) {
    if (error?.name === "AbortError") return "timeout";
    if (!status) return "network_error";
    if (status === 408) return "upstream_408";
    if (status === 429) return "upstream_429";
    if (status >= 500) return `upstream_${status}`;
    return `upstream_${status}`;
}

export function isRetryableError(code) {
    return RETRYABLE_ERRORS.has(code) || /^upstream_5\d\d$/.test(code);
}
