import { getBackendApiConfigForCapability } from "./backend-api-config.js";

export async function compressJpeg(input, { fetchImpl = fetch, getConfig = getBackendApiConfigForCapability } = {}) {
    if (!input?.length || input.length > 20 * 1024 * 1024 || input[0] !== 0xff || input[1] !== 0xd8) {
        throw Object.assign(new Error("请提供 20 MB 以内的 JPG 图片"), { statusCode: 400 });
    }
    const config = await getConfig("tinify");
    if (!config?.apiKey) throw Object.assign(new Error("请先在本地设置中保存 Tinify API"), { statusCode: 400 });
    const headers = { Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}` };
    const response = await fetchImpl("https://api.tinify.com/shrink", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: input,
        signal: AbortSignal.timeout(120000),
        redirect: "error",
    });
    if (!response.ok) throw Object.assign(new Error(`Tinify 压缩失败 (${response.status})，请检查密钥、额度或稍后重试`), { statusCode: 502 });
    const data = await response.json();
    const output = new URL(data.output?.url || "", "https://api.tinify.com");
    if (output.origin !== "https://api.tinify.com" || !output.pathname.startsWith("/output/")) throw new Error("Tinify 返回了无效的结果地址");
    const result = await fetchImpl(output.href, { headers, signal: AbortSignal.timeout(120000), redirect: "error" });
    if (!result.ok) throw new Error(`压缩结果下载失败 (${result.status})`);
    const bytes = Buffer.from(await result.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("压缩结果不是 JPG 图片");
    return bytes;
}
