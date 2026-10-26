import { importSkillFiles, validateSkill } from "../../../server/lib/chat-skill-schema.js";
export type SkillFile = { path: string; content: string };
export type SkillInput = { name: string; description: string; instructions: string; files: SkillFile[]; enabled: boolean };
export type ChatSkill = SkillInput & { id: string; version: number; source: "personal"; createdAt: string; updatedAt: string };
export type SkillSnapshot = Pick<ChatSkill, "id" | "name" | "description" | "instructions" | "files" | "version">;
export { validateSkill };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "技能库操作失败");
    return data;
}
export const fetchChatSkills = () => request<{ skills: ChatSkill[] }>("/api/chat-skills").then((r) => r.skills);
export const saveChatSkill = (input: SkillInput, existing?: ChatSkill) =>
    request<{ skill: ChatSkill }>(existing ? `/api/chat-skills/${existing.id}` : "/api/chat-skills", { method: existing ? "PUT" : "POST", body: JSON.stringify({ ...validateSkill(input), expectedVersion: existing?.version }) }).then((r) => r.skill);
export const removeChatSkill = (skill: ChatSkill) => request(`/api/chat-skills/${skill.id}?version=${skill.version}`, { method: "DELETE" });
export async function readSkillImport(files: File[]): Promise<SkillInput> {
    if (files.some((f) => f.size > 500000) || files.reduce((n, f) => n + f.size, 0) > 2000000) throw new Error("单文件最多 500 KB，文件夹最多 2 MB。");
    const entries = await Promise.all(files.map(async (file) => ({ path: file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name, content: await file.text() })));
    const draft = importSkillFiles(entries);
    // Validate resources now; the editable preview can repair missing name/description.
    validateSkill({ ...draft, name: "import-preview", description: draft.description || "待填写", instructions: draft.instructions || "待填写" });
    return draft;
}
export function snapshotSkills(skills: ChatSkill[], ids: string[]): SkillSnapshot[] {
    const unique = [...new Set(ids)];
    if (unique.length > 3) throw new Error("每个会话最多启用 3 个技能。");
    const result = unique.map((id) => {
        const s = skills.find((s) => s.id === id);
        if (!s || !s.enabled) throw new Error(`技能「${s?.name || id}」已停用或删除，请移除后再发送。`);
        const { name, description, instructions, files, version } = s;
        return { id, name, description, instructions, files, version };
    });
    if (JSON.stringify(result).length > 65000) throw new Error("选中技能与资料总量过大，请减少启用技能后再发送。");
    return result;
}
