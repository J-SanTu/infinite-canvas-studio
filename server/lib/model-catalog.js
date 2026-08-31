import { readDb } from "./store.js";

const DEFAULT_CATALOG = [
    { id: "gpt-image-2", label: "GPT Image 2", capability: "image", supportsReferences: true, tags: ["默认", "图片"] },
    { id: "grok-imagine-video", label: "Grok Imagine Video", capability: "video", supportsReferences: true, tags: ["视频"] },
    { id: "gpt-5.5", label: "GPT 5.5", capability: "text", supportsReferences: false, tags: ["文本"] },
    { id: "gpt-4o-mini-tts", label: "GPT 4o Mini TTS", capability: "audio", supportsReferences: false, tags: ["音频"] },
    { id: "music_v2", label: "ElevenLabs Music v2", capability: "music", supportsReferences: false, tags: ["音乐"] },
];

export async function listModelCatalog(_workspace, filters = {}) {
    const db = await readDb();
    const configuredModels = Object.entries(db.apiConfigs || {}).flatMap(([capability, config]) => (Array.isArray(config?.models) ? config.models : []).map((id) => ({ id, capability: capability === "music" ? "music" : capability })));
    const defaults = new Map(DEFAULT_CATALOG.map((model) => [model.id, model]));
    const models = Array.from(new Set([...DEFAULT_CATALOG.map((model) => model.id), ...configuredModels.map((model) => model.id)])).map((id) => {
        const configured = configuredModels.find((model) => model.id === id);
        return defaults.get(id) || { id, label: id, capability: configured?.capability || inferCapability(id), supportsReferences: false, tags: [] };
    });
    const capability = String(filters.capability || "")
        .trim()
        .toLowerCase();
    return models.filter((model) => !capability || model.capability === capability).map((model) => ({ ...model, enabled: true, updatedAt: null }));
}

function inferCapability(id) {
    const value = String(id).toLowerCase();
    if (/video|sora|veo|kling|wan|seedance/.test(value)) return "video";
    if (/music/.test(value)) return "music";
    if (/audio|tts|speech|voice|sound/.test(value)) return "audio";
    if (/image|dall|flux|imagen|seedream|stable/.test(value)) return "image";
    return "text";
}
