import { readDb, updateDb } from "./store.js";

export async function getUiPreferences() {
    const db = await readDb();
    return normalizePreferences(db.uiPreferences);
}

export async function updateUiPreferences(input = {}) {
    const next = normalizePreferences(input);
    return updateDb((db) => {
        db.uiPreferences = next;
        return next;
    });
}

function normalizePreferences(value) {
    if (!value || typeof value !== "object" || !value.imageToolbar || typeof value.imageToolbar !== "object") return {};
    const imageToolbar = value.imageToolbar;
    const ids = Array.isArray(imageToolbar.ids) ? imageToolbar.ids.map((id) => String(id)).slice(0, 32) : [];
    return {
        imageToolbar: {
            ids,
            showLabels: imageToolbar.showLabels === true,
        },
    };
}
