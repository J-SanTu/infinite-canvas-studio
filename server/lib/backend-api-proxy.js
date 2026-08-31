import { randomUUID } from "node:crypto";

import { getBackendApiConfigForUser } from "./backend-api-config.js";
import { classifyUpstreamFailure, createGenerationRun, isRetryableError, transitionGenerationRun } from "./generation-runs.js";
import { assertImageTokenAvailable, imageOperationFromPath, isSuccessfulImagePayload, readImageOutputCount, readImageRequestMetadata, readImageUsageFromPayload, recordImageUsageSafely, withImageUsageSlot } from "./image-usage.js";

const hopByHopHeaders = new Set(["connection", "content-length", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export async function proxyBackendApi(req, res, pathname, user) {
    const upstreamPath = pathname.replace(/^\/api\/ai/, "");
    const imageOperation = imageOperationFromPath(upstreamPath, req.headers["x-canvas-image-operation"]);
    const capability = requestCapability(upstreamPath, req.headers["x-canvas-capability"], imageOperation);
    if (imageOperation) {
        const config = await getBackendApiConfigForUser(user, { capability: "image", imageOperation: true });
        return withImageUsageSlot(imageApiSlotKey(config), () => proxyRequest(req, res, upstreamPath, user, imageOperation, config));
    }
    return proxyRequest(req, res, upstreamPath, user, null, null, capability);
}

async function proxyRequest(req, res, upstreamPath, user, imageOperation, resolvedConfig, capability = imageOperation ? "image" : "audio") {
    const config = resolvedConfig || (await getBackendApiConfigForUser(user, { capability, imageOperation: Boolean(imageOperation) }));
    if (!config) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "后端配置API尚未配置" }));
        return;
    }

    if (imageOperation) await assertImageTokenAvailable(user.id);
    const target = `${config.baseUrl.replace(/\/+$/, "")}${normalizeUpstreamPath(config.baseUrl, upstreamPath)}`;
    const headers = filterRequestHeaders(req.headers);
    headers.delete("x-canvas-capability");
    if (capability === "music") {
        headers.delete("authorization");
        headers.set("xi-api-key", config.apiKey);
    } else {
        headers.delete("xi-api-key");
        headers.set("Authorization", `Bearer ${config.apiKey}`);
    }
    const requestBody = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const requestId = normalizeRequestId(req.headers["x-canvas-request-id"]);
    const imageMetadata = imageOperation
        ? await readImageRequestMetadata(requestBody, req.headers["content-type"], {
              quality: req.headers["x-canvas-image-quality"],
              model: req.headers["x-canvas-image-model"],
              requestedCount: req.headers["x-canvas-image-count"],
          })
        : null;
    let generationRun = null;
    if (imageOperation) {
        try {
            generationRun = await createGenerationRun(user.id, {
                requestId,
                operation: imageOperation,
                capability: "image",
                modelId: imageMetadata?.model,
                parameterSnapshot: { quality: imageMetadata?.qualityTier, requestedCount: imageMetadata?.requestedCount },
            });
            if (generationRun.created === false) {
                res.statusCode = 409;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.setHeader("Cache-Control", "no-store");
                res.end(JSON.stringify({ error: "该 request id 已处理，请使用任务中心查看结果", generationRun }));
                return;
            }
            if (generationRun.status === "queued") await transitionGenerationRun(user.id, generationRun.id, "running");
        } catch (error) {
            console.error(`Generation run could not be created: ${formatUpstreamError(error)}`);
        }
    }

    let response;
    try {
        response = await fetch(target, {
            method: req.method,
            headers,
            body: requestBody,
            duplex: "half",
        });
    } catch (error) {
        if (generationRun) {
            const errorCode = classifyUpstreamFailure(0, error);
            await transitionGenerationRun(user.id, generationRun.id, isRetryableError(errorCode) ? "retryable_failed" : "failed", { errorCode, errorMessageSafe: formatUpstreamError(error) }).catch(() => undefined);
        }
        if (res.headersSent) {
            res.destroy(error);
            return;
        }
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ error: `AI 上游接口连接失败：${formatUpstreamError(error)}` }));
        return;
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (imageOperation && response.ok) {
        const payload = parseJson(body);
        if (isSuccessfulImagePayload(payload)) {
            const accounting = await recordImageUsageSafely({
                userId: user.id,
                operation: imageOperation,
                usage: readImageUsageFromPayload(payload),
                imageCount: readImageOutputCount(payload),
                qualityTier: imageMetadata?.qualityTier,
                model: imageMetadata?.model,
                requestId,
            });
            if (generationRun) {
                await transitionGenerationRun(user.id, generationRun.id, "succeeded", {
                    usageEventId: accounting.event?.id,
                    outputAssetIds: [],
                }).catch(() => undefined);
            }
            res.setHeader("X-Canvas-Usage-Status", accounting.status);
        } else if (generationRun) {
            await transitionGenerationRun(user.id, generationRun.id, "failed", {
                errorCode: "response_parse_error",
                errorMessageSafe: "上游返回成功状态但没有可识别的图片结果",
            }).catch(() => undefined);
        }
    } else if (generationRun) {
        const errorCode = classifyUpstreamFailure(response.status);
        await transitionGenerationRun(user.id, generationRun.id, isRetryableError(errorCode) ? "retryable_failed" : "failed", {
            errorCode,
            errorMessageSafe: `上游返回 ${response.status}`,
        }).catch(() => undefined);
    }

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        if (!hopByHopHeaders.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.end(body);
}

function imageApiSlotKey(config) {
    if (!config) return "missing";
    return `${config.source || "default"}:${config.baseUrl || ""}:${config.apiKeyHash || ""}`;
}

function requestCapability(pathname, header, imageOperation) {
    if (imageOperation) return "image";
    const value = String(header || "")
        .trim()
        .toLowerCase();
    if (["video", "music", "audio", "image", "text"].includes(value)) return value;
    if (/\/music(?:\/|$)|\/sound-generation(?:\/|$)/i.test(pathname)) return "music";
    if (/\/videos(?:\/|$)|\/contents\/generations\/tasks/i.test(pathname)) return "video";
    if (/\/responses(?:\/|$)|\/chat\/completions(?:\/|$)/i.test(pathname)) return "text";
    return "audio";
}

function normalizeUpstreamPath(baseUrl, pathname) {
    const base = String(baseUrl || "")
        .replace(/\/+$/, "")
        .toLowerCase();
    if ((base.endsWith("/api/v3") || base.endsWith("/api/plan/v3") || base.endsWith("/v1")) && String(pathname || "").startsWith("/v1/")) return String(pathname).slice(3);
    return pathname || "/";
}

function normalizeRequestId(value) {
    const requestId = String(value || "").trim();
    return /^[A-Za-z0-9_:.\-]{8,160}$/.test(requestId) ? requestId : `image_request_${randomUUID()}`;
}

function parseJson(body) {
    try {
        return JSON.parse(body.toString("utf8"));
    } catch {
        return null;
    }
}

function filterRequestHeaders(source) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(source)) {
        if (hopByHopHeaders.has(key.toLowerCase())) continue;
        if (key.toLowerCase() === "authorization") continue;
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
        else if (value !== undefined) headers.set(key, value);
    }
    return headers;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function formatUpstreamError(error) {
    if (error instanceof Error && error.message) return error.message;
    return "网络连接异常";
}
