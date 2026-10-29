import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readDb, updateDb, dbPath } from "./store.js";
const keys = ["imageModel", "textModel", "videoModel", "audioModel"];
const empty = () => Object.fromEntries(keys.map(key => [key, ""]));
const invalid = message => Object.assign(new Error(message), { status: 400, statusCode: 400 });
export async function getDefaultModels() { return (await readDb()).defaultModelPreferences; }
export async function saveDefaultModels(input = {}) {
    return updateDb(async db => {
        if (input.initialize === true && db.defaultModelPreferences) return db.defaultModelPreferences;
        if (!db.defaultModelPreferences) {
            try { await writeFile(`${dbPath}.pre-default-models.bak`, await readFile(dbPath), { flag: "wx", mode: 0o600 }); }
            catch (error) { if (error.code !== "ENOENT" && error.code !== "EEXIST") throw error; }
        }
        const current = db.defaultModelPreferences || { schemaVersion: 1, ...empty(), defaultModelsRevision: "" };
        const next = { ...current };
        for (const key of keys) {
            if (!(key in input)) continue;
            const value = input[key];
            if (typeof value !== "string" || value.length > 2048) throw invalid("模型标识无效");
            // Initialization preserves legacy identities even when a channel is unavailable.
            if (input.initialize !== true && value) {
                const capability = key.slice(0, -5);
                const split = value.indexOf("::");
                const id = value.slice(0, split), model = value.slice(split + 2);
                const group = db.apiConfigs[capability];
                const channel = id === `${capability}-default` ? group : group?.channels?.find(item => item.id === id);
                if (split < 1 || channel?.modelsStatus !== "ready" || !channel?.models?.includes(model)) throw invalid("所选模型尚未验证或已不可用，请刷新列表");
            }
            next[key] = value;
        }
        const changed = keys.some(key => next[key] !== current[key]);
        next.defaultModelsRevision = input.initialize === true && typeof input.defaultModelsRevision === "string"
            ? input.defaultModelsRevision.slice(0, 200) : changed ? randomUUID() : current.defaultModelsRevision;
        db.defaultModelPreferences = next;
        return next;
    });
}
