import { useConfigStore, type DefaultModels } from "@/stores/use-config-store";
type Saved = DefaultModels & { defaultModelsRevision: string };
async function request(input?: object): Promise<Saved | null> {
    const response = await fetch("/api/settings/default-models", input ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : undefined);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "默认模型保存失败");
    return data.defaults;
}
function apply(saved: Saved) {
    useConfigStore.setState(state => ({ config: { ...state.config, ...saved, model: saved.imageModel } }));
}
let restoring: Promise<void> | undefined;
export function restoreDefaultModels() {
    if (useConfigStore.getState().defaultsReady) return Promise.resolve();
    if (restoring) return restoring;
    useConfigStore.setState({ defaultsError: "" });
    restoring = (async () => {
        let saved = await request();
        if (!saved) {
            const c = useConfigStore.getState().config;
            saved = await request({ initialize: true, imageModel: c.imageModel, textModel: c.textModel, videoModel: c.videoModel, audioModel: c.audioModel, defaultModelsRevision: c.defaultModelsRevision || "" });
        }
        if (saved) apply(saved);
        useConfigStore.setState({ defaultsReady: true });
    })().catch(error => {
        useConfigStore.setState({ defaultsError: `默认模型恢复失败：${error.message}` });
    }).finally(() => { restoring = undefined; });
    return restoring;
}
let queue = Promise.resolve();
let sequence = 0;
const latestByKey: Partial<Record<keyof DefaultModels, number>> = {};
export function saveDefaultModel(key: keyof DefaultModels, value: string) {
    if (!useConfigStore.getState().defaultsReady) return;
    const ticket = ++sequence;
    latestByKey[key] = ticket;
    useConfigStore.setState(state => ({ pendingDefaults: { ...state.pendingDefaults, [key]: value }, defaultsSaveStatus: "saving", defaultsSaveError: "" }));
    queue = queue.then(async () => {
        try {
            const saved = await request({ [key]: value });
            if (saved) apply(saved);
            useConfigStore.setState(state => {
                const pending = { ...state.pendingDefaults };
                if (latestByKey[key] === ticket) delete pending[key];
                return { pendingDefaults: pending, ...(ticket === sequence ? { defaultsSaveStatus: Object.keys(pending).length ? "error" as const : "saved" as const } : {}) };
            });
        } catch (error) {
            useConfigStore.setState({ defaultsSaveStatus: "error", defaultsSaveError: error instanceof Error ? error.message : "保存失败" });
        }
    });
    return queue;
}
export function retryDefaultModels() {
    for (const [key, value] of Object.entries(useConfigStore.getState().pendingDefaults)) saveDefaultModel(key as keyof DefaultModels, value!);
}
