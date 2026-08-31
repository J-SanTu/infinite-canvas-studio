import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { LOCAL_WORKSPACE_ID, localWorkspace } from "./local-workspace.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultDbPath = resolve(serverDir, "data/app-db.json");

export const dbPath = process.env.CANVAS_DB_PATH ? resolve(process.env.CANVAS_DB_PATH) : defaultDbPath;
let dbWriteQueue = Promise.resolve();

export function createId(prefix) {
    return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export async function readDb() {
    try {
        const raw = await readFile(dbPath, "utf8");
        return normalizeDb(JSON.parse(raw));
    } catch (error) {
        if (error && error.code === "ENOENT") return normalizeDb({});
        throw error;
    }
}

export async function writeDb(db) {
    await mkdir(dirname(dbPath), { recursive: true });
    const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(normalizeDb(db), null, 2)}\n`, "utf8");
    await rename(tempPath, dbPath);
}

export async function updateDb(mutator) {
    const run = dbWriteQueue.then(async () => {
        const db = await readDb();
        const result = await mutator(db);
        await writeDb(db);
        return result;
    });
    dbWriteQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

function normalizeDb(source) {
    const legacyUsers = Array.isArray(source.users) ? source.users : [];
    const legacyOwnerIds = new Set(legacyUsers.map((user) => user.id).filter(Boolean));
    const localizeRows = (rows, key = "userId") =>
        (Array.isArray(rows) ? rows : []).map((row) => {
            const { tenantId: _tenantId, ...record } = row || {};
            return { ...record, ...(record[key] || legacyOwnerIds.size ? { [key]: LOCAL_WORKSPACE_ID } : {}) };
        });
    const legacyTenantConfigs = source.backendApisByTenant && typeof source.backendApisByTenant === "object" ? Object.values(source.backendApisByTenant) : [];
    return {
        users: [{ ...localWorkspace }],
        sessions: [],
        canvasProjects: localizeRows(source.canvasProjects),
        storageObjects: localizeRows(source.storageObjects),
        assets: localizeRows(source.assets),
        assetFolders: localizeRows(source.assetFolders),
        prompts: localizeRows(source.prompts),
        promptLibraryItems: localizeRows(source.promptLibraryItems, "ownerUserId").map((item) => ({ ...item, scope: "personal", ownerDisplayName: localWorkspace.displayName })),
        promptLibraryFolders: localizeRows(source.promptLibraryFolders, "ownerUserId").map((item) => ({ ...item, scope: "personal" })),
        imageUsageEvents: localizeRows(source.imageUsageEvents),
        generationRuns: localizeRows(source.generationRuns),
        assetLibraryRevisions: localizeRows(source.assetLibraryRevisions),
        assetLibraryChanges: localizeRows(source.assetLibraryChanges),
        modelCatalog: Array.isArray(source.modelCatalog) ? source.modelCatalog : [],
        directorProjects: localizeRows(source.directorProjects),
        apiConfigs: source.apiConfigs && typeof source.apiConfigs === "object" ? source.apiConfigs : migrateLegacyApiConfigs(source.backendApi || legacyTenantConfigs[0] || null, legacyUsers),
    };
}

function migrateLegacyApiConfigs(config, users) {
    const root = config && typeof config === "object" ? config : {};
    const localUser = users.find((user) => user.imageApi?.encryptedApiKey || user.videoApi?.encryptedApiKey || user.audioApi?.encryptedApiKey || user.musicApi?.encryptedApiKey) || {};
    const result = {};
    if (localUser.imageApi?.encryptedApiKey || root.encryptedApiKey) result.image = localUser.imageApi?.encryptedApiKey ? localUser.imageApi : root;
    if (root.encryptedApiKey) result.text = root;
    for (const capability of ["video", "audio", "music"]) {
        const userConfig = localUser[`${capability}Api`];
        const rootConfig = root[`${capability}Api`];
        if (userConfig?.encryptedApiKey || rootConfig?.encryptedApiKey) result[capability] = userConfig?.encryptedApiKey ? userConfig : rootConfig;
    }
    return result;
}
