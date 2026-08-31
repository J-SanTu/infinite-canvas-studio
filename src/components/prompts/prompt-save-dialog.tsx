import { useEffect, useMemo, useState } from "react";
import { App, Input, Modal, Select } from "antd";
import { nanoid } from "nanoid";
import { useQueryClient } from "@tanstack/react-query";

import { usePromptLibraryQuery } from "./use-prompt-library-query";
import { createPromptLibraryItem } from "@/services/prompt-library";
import { uploadImage } from "@/services/image-storage";
import { usePromptLibraryStore } from "@/stores/use-prompt-library-store";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptLibraryItem, PromptSaveSource } from "@/types/prompt-library";

export function PromptSaveDialog({ open, source, onOpenChange, onSaved }: { open: boolean; source: PromptSaveSource | null; onOpenChange: (open: boolean) => void; onSaved?: (item: PromptLibraryItem) => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const user = useUserStore((state) => state.user);
    const resetForUser = usePromptLibraryStore((state) => state.resetForUser);
    const scope = "personal" as const;
    const [folderId, setFolderId] = useState("unfiled");
    const [title, setTitle] = useState("");
    const [prompt, setPrompt] = useState("");
    const [tags, setTags] = useState("");
    const [saving, setSaving] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState("");
    const { folders } = usePromptLibraryQuery({ userId: user?.id, scope, enabled: open });

    useEffect(() => {
        if (user?.id) resetForUser(user.id);
    }, [resetForUser, user?.id]);

    useEffect(() => {
        if (!open || !source) return;
        setFolderId("unfiled");
        setTitle(source.title || Array.from(source.prompt).slice(0, 24).join(""));
        setPrompt(source.prompt);
        setTags("");
        setSaving(false);
        setIdempotencyKey(`prompt:${nanoid()}`);
    }, [open, source]);

    const folderOptions = useMemo(() => [{ label: "未分类", value: "unfiled" }, ...folders.map((folder) => ({ label: folder.name, value: folder.id }))], [folders]);
    const save = async () => {
        if (!source?.imageUrl || !prompt.trim()) return message.warning("图片和提示词不能为空");
        setSaving(true);
        try {
            const stored = source.imageStorageKey ? { storageKey: source.imageStorageKey, width: source.imageWidth, height: source.imageHeight } : await uploadImage(source.imageUrl);
            const input = {
                scope,
                folderId: folderId === "unfiled" ? null : folderId,
                title: title.trim(),
                prompt: prompt.trim(),
                tags: tags
                    .split(/[，,]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                imageStorageKey: stored.storageKey,
                imageWidth: stored.width,
                imageHeight: stored.height,
                sourceType: source.sourceType,
                sourceRefId: source.sourceRefId,
                idempotencyKey,
            } as const;
            let item;
            try {
                item = await createPromptLibraryItem(input);
            } catch (error) {
                if (!source.imageStorageKey || !(error instanceof Error) || !error.message.includes("图片不属于本地工作区或不存在")) throw error;
                const uploaded = await uploadImage(source.imageUrl);
                item = await createPromptLibraryItem({ ...input, imageStorageKey: uploaded.storageKey, imageWidth: uploaded.width, imageHeight: uploaded.height });
            }
            await queryClient.invalidateQueries({ queryKey: ["prompt-library", user.id] });
            message.success("已保存到本地提示词库");
            onSaved?.(item);
            onOpenChange(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提示词保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            title="保存提示词"
            open={open}
            okText="保存"
            cancelText="取消"
            confirmLoading={saving}
            okButtonProps={{ disabled: !source?.imageUrl || !prompt.trim() }}
            onOk={() => void save()}
            onCancel={() => onOpenChange(false)}
            width={720}
            destroyOnHidden={false}
        >
            {source ? (
                <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
                    <img src={source.imageUrl} alt={title || "生成图片"} className="aspect-[4/3] w-full rounded-md bg-stone-100 object-cover dark:bg-stone-900" />
                    <div className="min-w-0 space-y-4">
                        <div>
                            <div className="mb-1 text-xs font-medium opacity-60">标题</div>
                            <Input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
                        </div>
                        <div>
                            <div className="mb-1 text-xs font-medium opacity-60">文件夹</div>
                            <Select className="w-full" value={folderId} options={folderOptions} onChange={setFolderId} />
                        </div>
                        <div>
                            <div className="mb-1 text-xs font-medium opacity-60">提示词</div>
                            <Input.TextArea rows={6} maxLength={8000} showCount value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                        </div>
                        <div>
                            <div className="mb-1 text-xs font-medium opacity-60">标签</div>
                            <Input value={tags} placeholder="用逗号分隔，最多 20 个" onChange={(event) => setTags(event.target.value)} />
                        </div>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
