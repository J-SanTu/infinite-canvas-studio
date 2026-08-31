import { create } from "zustand";

export type LocalUser = {
    id: "local";
    username: "local";
    displayName: "本地工作区";
    avatarUrl: "";
    role: "local";
    status: "active";
};

const localWorkspace: LocalUser = {
    id: "local",
    username: "local",
    displayName: "本地工作区",
    avatarUrl: "",
    role: "local",
    status: "active",
};

type UserStore = {
    user: LocalUser;
    loading: false;
    initialized: true;
    loadSession: () => Promise<LocalUser>;
    clearSession: () => void;
    setUser: () => void;
};

// Existing project, asset, and prompt stores use a stable owner key internally.
// In the desktop edition this key identifies the only local workspace, not an account.
export const useUserStore = create<UserStore>()(() => ({
    user: localWorkspace,
    loading: false,
    initialized: true,
    loadSession: async () => localWorkspace,
    clearSession: () => undefined,
    setUser: () => undefined,
}));
