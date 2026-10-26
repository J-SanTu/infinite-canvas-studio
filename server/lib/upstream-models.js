// Preserve provider IDs exactly; discovery never substitutes a built-in model.
export async function discoverModels(config) {
    const base = config.baseUrl.replace(/\/+$/, "");
    const gemini = config.apiFormat === "gemini";
    const elevenLabs = config.capability === "music" && new URL(base).hostname === "api.elevenlabs.io";
    const url = new URL(`${base}${gemini ? (/\/v1(?:beta)?$/.test(base) ? "" : "/v1beta") : (/\/(?:v1|api\/v3|api\/plan\/v3)$/.test(base) ? "" : "/v1")}/models`);
    const headers = gemini ? { "x-goog-api-key": config.apiKey } : elevenLabs ? { "xi-api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` };
    const signal = AbortSignal.timeout(20000);
    const models = [];
    const pages = new Set();
    for (;;) {
        const response = await fetch(url, { headers, signal, redirect: "error" });
        // Never expose raw provider errors, which can echo credentials.
        if (!response.ok) throw new Error(`上游模型列表请求失败（HTTP ${response.status}）`);
        const payload = await response.json();
        const entries = gemini ? payload.models : Array.isArray(payload) ? payload : payload.data;
        if (!Array.isArray(entries)) throw new Error("上游未返回可识别的模型列表");
        for (const entry of entries) {
            const id = gemini ? entry?.name?.replace(/^models\//, "") : entry?.id ?? entry?.model_id;
            if (typeof id === "string" && id.trim()) models.push(id);
        }
        const token = gemini ? payload.nextPageToken : null;
        if (!token) {
            if (payload.has_more === true) throw new Error("上游返回分页模型列表，尚未获取完整，请检查接口兼容性");
            break;
        }
        if (pages.has(token) || pages.size >= 100) throw new Error("上游模型分页异常");
        pages.add(token);
        url.searchParams.set("pageToken", token);
    }
    const unique = [...new Set(models)];
    if (!unique.length) throw new Error("上游返回空模型列表，请检查账号权限或接口配置");
    return unique;
}

export function inferModelCapability(id) {
    const value = id.toLowerCase();
    if (/video|sora|veo|kling|wan|seedance|hailuo/.test(value)) return "video";
    if (/music/.test(value)) return "music";
    if (/audio|tts|speech|voice|sound/.test(value)) return "audio";
    if (/image|dall|flux|imagen|seedream|stable|sdxl|midjourney/.test(value)) return "image";
    return "text";
}
