import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
function publicAddress(ip) {
    if (isIP(ip) !== 4) return false;
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}
export async function readProductPage(input, depth = 0) {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw Error("产品链接必须为公开 HTTPS 网页");
    const addresses = await lookup(url.hostname, { all: true, family: 4 });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw Error("不支持访问本地或非公开地址");
    const result = await new Promise((resolve, reject) => {
        const req = https.get(url, { lookup: (_host, options, cb) => (options.all ? cb(null, addresses) : cb(null, addresses[0].address, 4)), headers: { "User-Agent": "Santu-Product-Reader/1.0" } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400) {
                res.resume();
                resolve({ redirect: res.headers.location });
                return;
            }
            if (res.statusCode !== 200 || !String(res.headers["content-type"]).includes("text/html")) {
                res.resume();
                reject(Error("无法读取产品网页，请粘贴产品资料"));
                return;
            }
            const chunks = [];
            let size = 0;
            res.on("data", (chunk) => {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) {
                    req.destroy(Error("网页内容过大"));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("error", reject);
            res.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
        });
        req.setTimeout(15000, () => req.destroy(Error("产品网页读取超时")));
        req.on("error", reject);
    });
    if (result.redirect) {
        if (depth >= 3) throw Error("网页重定向过多");
        return readProductPage(new URL(result.redirect, url).href, depth + 1);
    }
    const text = result.html
        .replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 18000);
    if (!text) throw Error("未提取到产品内容");
    return { text, url: url.href };
}
