import { readDb, updateDb, createId } from "./store.js";
import { validateSkill } from "./chat-skill-schema.js";
function fail(message, statusCode = 400) {
    throw Object.assign(new Error(message), { statusCode });
}
export async function listChatSkills() {
    return { skills: (await readDb()).chatSkills };
}
export async function saveChatSkill(input, id) {
    let data;
    try {
        data = validateSkill(input);
    } catch (error) {
        fail(error.message);
    }
    return updateDb((db) => {
        const existing = id ? db.chatSkills.find((s) => s.id === id) : null;
        if (id && !existing) fail("技能已删除，请刷新技能库。", 404);
        if (existing && input.expectedVersion !== existing.version) fail("技能已在其他窗口更新，请刷新后重新编辑。", 409);
        if (db.chatSkills.some((s) => s.name === data.name && s.id !== id)) fail("同名技能已存在，请编辑原技能或更改名称。", 409);
        if (!existing && db.chatSkills.length >= 100) fail("技能库最多保存 100 个技能。");
        const now = new Date().toISOString();
        const skill = { ...data, id: id || createId("skill"), source: "personal", version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now };
        if (existing) db.chatSkills = db.chatSkills.map((s) => (s.id === id ? skill : s));
        else db.chatSkills.push(skill);
        return { skill };
    });
}
export async function deleteChatSkill(id, version) {
    return updateDb((db) => {
        const item = db.chatSkills.find((s) => s.id === id);
        if (!item) fail("技能已删除。", 404);
        if (item.version !== version) fail("技能版本已变化，请刷新后重试。", 409);
        db.chatSkills = db.chatSkills.filter((s) => s.id !== id);
        return { deleted: id };
    });
}
