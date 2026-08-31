export type PromptLibraryScope = "personal";

export type PromptLibraryItem = {
    id: string;
    scope: PromptLibraryScope;
    ownerUserId: string;
    ownerDisplayName: string;
    folderId: string | null;
    title: string;
    prompt: string;
    tags: string[];
    imageUrl: string;
    imageMimeType: string;
    imageWidth: number;
    imageHeight: number;
    imageBytes: number;
    sourceType: "image-workbench" | "canvas";
    sourceRefId: string;
    createdAt: string;
    updatedAt: string;
    canManage: boolean;
};

export type PromptLibraryFolder = {
    id: string;
    scope: PromptLibraryScope;
    ownerUserId: string;
    name: string;
    count: number;
    createdAt: string;
    updatedAt: string;
    canManage: boolean;
};

export type PromptLibraryListResponse = {
    items: PromptLibraryItem[];
    folders: PromptLibraryFolder[];
    nextCursor: string | null;
    total: number;
};

export type CreatePromptLibraryItemInput = {
    scope: PromptLibraryScope;
    folderId: string | null;
    title: string;
    prompt: string;
    tags: string[];
    imageStorageKey: string;
    imageWidth: number;
    imageHeight: number;
    sourceType: "image-workbench" | "canvas";
    sourceRefId: string;
    idempotencyKey: string;
};

export type PromptSaveSource = {
    imageUrl: string;
    imageStorageKey?: string;
    imageWidth: number;
    imageHeight: number;
    imageBytes?: number;
    imageMimeType?: string;
    prompt: string;
    title: string;
    sourceType: "image-workbench" | "canvas";
    sourceRefId: string;
};
