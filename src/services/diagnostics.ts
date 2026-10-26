import type { StoreApi } from "zustand";
import { APP_VERSION } from "@/constant/env";

type DiagnosticEvent = Record<string, unknown> & { event: string; level: string; eventId: string; clientTime: string };
const queue: DiagnosticEvent[] = [];
let started = false, sending = false, dropped = 0;
const nativeFetch = globalThis.fetch.bind(globalThis);

export function recordDiagnostic(event: string, details: Record<string, unknown> = {}, level = "info") {
    if (typeof window === "undefined") return;
    if (queue.length >= 2000) { queue.shift(); dropped++; }
    queue.push({ ...details, event, level, eventId: crypto.randomUUID(), clientTime: new Date().toISOString(), page: location.pathname });
}

export async function flushDiagnostics() {
    if (sending || !queue.length) return;
    sending = true;
    const batch = queue.splice(0, 20);
    try {
        const response = await nativeFetch("/api/diagnostics/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }), signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("日志服务暂不可用");
        if (dropped) { recordDiagnostic("queue.overflow", { dropped }, "warn"); dropped = 0; }
    } catch {
        queue.unshift(...batch);
        if (queue.length > 2000) { dropped += queue.length - 2000; queue.splice(2000); }
    } finally { sending = false; }
}

function errorDetails(error: unknown) {
    return error instanceof Error ? { name: error.name, message: error.message.slice(0, 2000), stack: error.stack?.slice(0, 2500) } : { message: String(error).slice(0, 2000) };
}

// Record operation identity and outcome, never arguments/return values (which can contain keys, prompts or images).
export function instrumentStore<T extends object>(name: string, store: StoreApi<T>) {
    const patch: Record<string, unknown> = {};
    for (const [action, fn] of Object.entries(store.getState())) {
        if (typeof fn !== "function") continue;
        patch[action] = (...args: unknown[]) => {
            const operationId = crypto.randomUUID();
            const start = performance.now();
            const context: Record<string, unknown> = { action: `${name}.${action}`, operationId };
            if (name === "canvas" && /^(openProject|renameProject|updateProject)$/.test(action)) context.projectId = String(args[0]).slice(0, 100);
            if (name === "config" && action === "updateConfig") context.field = String(args[0]).slice(0, 60);
            if (name === "canvas" && action === "updateProject" && args[1] && typeof args[1] === "object") context.fields = Object.keys(args[1]);
            recordDiagnostic("operation.start", context);
            const finish = (result: unknown) => {
                const projectId = name === "canvas" && /^(createProject|importProject)$/.test(action) ? result : context.projectId;
                recordDiagnostic("operation.end", { ...context, projectId, status: "succeeded", durationMs: Math.round(performance.now() - start) });
                return result;
            };
            const fail = (error: unknown) => { recordDiagnostic("operation.error", { ...context, error: errorDetails(error), durationMs: Math.round(performance.now() - start) }, "error"); throw error; };
            try {
                const result = fn(...args);
                return result instanceof Promise ? result.then(finish, fail) : finish(result);
            } catch (error) { return fail(error); }
        };
    }
    store.setState(patch as Partial<T>);
}

export function startDiagnostics() {
    if (started) return;
    started = true;
    recordDiagnostic("app.ready", { version: APP_VERSION });
    window.addEventListener("error", (event) => recordDiagnostic("uncaught_error", { error: errorDetails(event.error || event.message) }, "error"));
    window.addEventListener("unhandledrejection", (event) => recordDiagnostic("unhandled_rejection", { error: errorDetails(event.reason) }, "error"));
    document.addEventListener("click", (event) => {
        const element = event.target instanceof Element ? event.target.closest("button,a,[role=button],[role=menuitem],[role=tab]") : null;
        if (element) recordDiagnostic("ui.click", { tag: element.tagName, role: element.getAttribute("role"), action: element.getAttribute("aria-label")?.slice(0, 80) || element.getAttribute("data-log-action") || element.tagName });
    }, true);
    document.addEventListener("change", (event) => {
        const element = event.target;
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
            recordDiagnostic("ui.change", { tag: element.tagName, controlType: element instanceof HTMLInputElement ? element.type : element.tagName });
    }, true);
    document.addEventListener("submit", () => recordDiagnostic("ui.submit"), true);
    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && /^(z|y|s|c|v|x|a|d|Enter)$/i.test(event.key))
            recordDiagnostic("ui.shortcut", { shortcut: `${event.ctrlKey ? "Ctrl" : "Meta"}${event.shiftKey ? "+Shift" : ""}+${event.key}` });
    }, true);
    window.addEventListener("pagehide", () => {
        recordDiagnostic("app.pagehide");
        while (queue.length) {
            const batch = queue.splice(0, 10);
            const ok = navigator.sendBeacon("/api/diagnostics/events", new Blob([JSON.stringify({ events: batch })], { type: "application/json" }));
            if (!ok) { queue.unshift(...batch); break; }
        }
    });
    let page = location.pathname;
    setInterval(() => {
        if (location.pathname !== page) { page = location.pathname; recordDiagnostic("ui.navigate"); }
        void flushDiagnostics();
    }, 500);
    // Requests from fetch-based services share their ID with the backend's detailed logs.
    window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/diagnostics")) return nativeFetch(input, init);
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        const requestId = headers.get("X-Canvas-Request-Id") || crypto.randomUUID();
        headers.set("X-Canvas-Request-Id", requestId);
        const context = { requestId, path: url.pathname, method: init?.method || (input instanceof Request ? input.method : "GET") };
        const start = performance.now();
        recordDiagnostic("request.start", context);
        try {
            const response = await nativeFetch(input, { ...init, headers });
            recordDiagnostic("request.end", { ...context, status: response.status, durationMs: Math.round(performance.now() - start) }, response.ok ? "info" : "warn");
            return response;
        } catch (error) {
            recordDiagnostic("request.error", { ...context, error: errorDetails(error), durationMs: Math.round(performance.now() - start) }, "error");
            throw error;
        }
    };
}
