/** @typedef {{path:string,content:string}} SkillFile */
/** @typedef {{name:string,description:string,instructions:string,files:SkillFile[],enabled:boolean}} SkillInput */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** @param {unknown} value @returns {SkillInput} */
export function validateSkill(value) {
    if (!value || typeof value !== "object") throw new Error("技能内容格式无效。");
    const v = /** @type {Record<string, unknown>} */ (value);
    const name = typeof v.name === "string" ? v.name.trim() : "";
    const description = typeof v.description === "string" ? v.description.trim() : "";
    const instructions = typeof v.instructions === "string" ? v.instructions.trim() : "";
    if (!NAME.test(name) || name.length > 80) throw new Error("技能名需为小写字母、数字和连字符，最多 80 字符。");
    if (!description || description.length > 1000) throw new Error("请填写 1–1000 字符的技能描述。");
    if (!instructions || instructions.length > 40000) throw new Error("请填写技能指令，最多 40000 字符。");
    if (v.files !== undefined && !Array.isArray(v.files)) throw new Error("技能附件格式无效。");
    const files = /** @type {unknown[]} */ (v.files || []).map((item) => {
        if (!item || typeof item !== "object") throw new Error("技能附件格式无效。");
        const file = /** @type {Record<string,unknown>} */ (item);
        if (typeof file.path !== "string" || typeof file.content !== "string") throw new Error("技能附件必须是文本文件。");
        const path = file.path.replace(/\\/g, "/");
        if (!path || path.length > 200 || path.startsWith("/") || /[\x00-\x1f:]/.test(path) || path.split("/").some((p) => p === ".." || p === "." || !p)) throw new Error("技能附件路径无效。");
        if (!/\.(md|markdown|txt|json|yaml|yml)$/i.test(path)) throw new Error("技能文件夹仅支持 Markdown、TXT、JSON、YAML 文本资料，不执行脚本。");
        if (file.content.includes("\0") || file.content.length > 40000) throw new Error("附件不是有效文本或超过 40000 字符。");
        return { path, content: file.content };
    });
    if (files.length > 30 || new Set(files.map((f) => f.path.toLowerCase())).size !== files.length) throw new Error("附件最多 30 个，且路径不能重复。");
    if (instructions.length + files.reduce((n, f) => n + f.content.length, 0) > 60000) throw new Error("技能正文与资料总计不能超过 60000 字符。");
    return { name, description, instructions, files, enabled: v.enabled !== false };
}

/** Extract supported scalar/block fields; imported Markdown is data, never evaluated.
 * @param {string} text @param {string} key */
function frontField(text, key) {
    const lines = text.split("\n");
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index < 0) return "";
    const value = lines[index].slice(key.length + 1).trim();
    if (/^[>|][-+]?$/.test(value)) {
        const block = [];
        for (let i = index + 1; i < lines.length && (/^\s/.test(lines[i]) || !lines[i]); i++) block.push(lines[i].replace(/^\s{1,}/, ""));
        return block.join(value.startsWith(">") ? " " : "\n").trim();
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch {
            throw new Error(`frontmatter 的 ${key} 引号格式无效。`);
        }
    }
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
    return value;
}
/** @param {string} source @param {string} filename */
export function parseSkillMarkdown(source, filename) {
    const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    let instructions = text;
    let name = "";
    let description = "";
    if (text.startsWith("---\n")) {
        const end = text.indexOf("\n---", 4);
        if (end < 0) throw new Error("Markdown frontmatter 缺少结束标记。");
        const front = text.slice(4, end);
        name = frontField(front, "name");
        description = frontField(front, "description");
        instructions = text.slice(end + 4).trim();
    }
    if (!name)
        name = filename
            .replace(/\.(md|markdown)$/i, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
    if (!description)
        description =
            instructions
                .split("\n")
                .map((s) => s.trim())
                .find((s) => s && !s.startsWith("#") && !s.startsWith("```"))
                ?.slice(0, 1000) || "";
    return { name, description, instructions, files: [], enabled: true };
}
/** @param {SkillFile[]} entries */
export function importSkillFiles(entries) {
    if (!entries.length || entries.length > 31) throw new Error("请选择一个技能文件，或包含入口及最多 30 个资料文件的文件夹。");
    const normalized = entries.filter((f) => !f.path.split("/").some((p) => p.startsWith(".")));
    let root = normalized.find((f) => /^SKILL\.(md|markdown)$/i.test(f.path));
    if (!root) {
        const markdown = normalized.filter((f) => !f.path.includes("/") && /\.(md|markdown)$/i.test(f.path));
        if (markdown.length === 1) root = markdown[0];
    }
    if (!root) throw new Error("文件夹根目录需有 SKILL.md，或唯一一个 Markdown 入口。");
    return { ...parseSkillMarkdown(root.content, root.path), files: normalized.filter((f) => f !== root) };
}
