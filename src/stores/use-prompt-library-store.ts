import { create } from "zustand";

import type { PromptLibraryScope } from "@/types/prompt-library";

type PromptLibraryUiStore = {
    sessionUserId: string;
    scope: PromptLibraryScope;
    resetForUser: (userId: string) => void;
    clearSession: () => void;
    setScope: (scope: PromptLibraryScope) => void;
};

export const usePromptLibraryStore = create<PromptLibraryUiStore>()((set, get) => ({
    sessionUserId: "",
    scope: "personal",
    resetForUser: (userId) => {
        if (get().sessionUserId === userId) return;
        set({ sessionUserId: userId, scope: "personal" });
    },
    clearSession: () => set({ sessionUserId: "", scope: "personal" }),
    setScope: () => set({ scope: "personal" }),
}));
