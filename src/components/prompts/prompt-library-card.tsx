import { useEffect, useState } from "react";
import { Button, Checkbox, Tag, Tooltip } from "antd";
import { Copy, ImageOff, Pencil, Trash2 } from "lucide-react";

import { PROMPT_LIBRARY_DRAG_MIME } from "./prompt-folder-sidebar";
import type { PromptLibraryItem } from "@/types/prompt-library";

export function PromptLibraryCard({
    item,
    selected,
    dragIds,
    onToggle,
    onOpen,
    onCopy,
    onEdit,
    onDelete,
}: {
    item: PromptLibraryItem;
    selected: boolean;
    dragIds: string[];
    onToggle: () => void;
    onOpen: () => void;
    onCopy: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const [imageFailed, setImageFailed] = useState(false);
    useEffect(() => setImageFailed(false), [item.imageUrl]);
    return (
        <article
            className={`group overflow-hidden rounded-md border bg-white transition hover:-translate-y-0.5 hover:shadow-md dark:bg-stone-950 ${selected ? "border-blue-500 ring-2 ring-blue-500/20" : "border-stone-200 dark:border-stone-800"}`}
            draggable={item.canManage}
            onDragStart={(event) => {
                const ids = selected && dragIds.length ? dragIds : [item.id];
                event.dataTransfer.setData(PROMPT_LIBRARY_DRAG_MIME, JSON.stringify(ids));
                event.dataTransfer.effectAllowed = "move";
            }}
        >
            <div className="relative aspect-[4/3] overflow-hidden bg-stone-100 dark:bg-stone-900">
                <button type="button" className="block h-full w-full" onClick={onOpen} aria-label={`查看${item.title}`}>
                    {imageFailed ? (
                        <span className="grid h-full place-items-center text-stone-400">
                            <ImageOff className="size-8" />
                        </span>
                    ) : (
                        <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
                    )}
                </button>
                {item.canManage ? <Checkbox className="absolute left-3 top-3 rounded bg-white/90 p-1 shadow-sm" checked={selected} aria-label={`选择${item.title}`} onChange={onToggle} /> : null}
            </div>
            <button type="button" className="block w-full p-3 text-left" onClick={onOpen}>
                <div className="truncate text-sm font-semibold">{item.title}</div>
                <p className="mt-2 line-clamp-3 min-h-[60px] text-xs leading-5 text-stone-600 dark:text-stone-400">{item.prompt}</p>
                <div className="mt-3 flex min-h-5 flex-wrap gap-1">
                    {item.tags.slice(0, 3).map((tag) => (
                        <Tag key={tag} className="m-0 text-[11px]">
                            {tag}
                        </Tag>
                    ))}
                </div>
            </button>
            <div className="flex h-11 items-center gap-1 border-t px-2 dark:border-stone-800">
                <Tooltip title="复制提示词">
                    <Button type="text" size="small" aria-label="复制提示词" icon={<Copy className="size-4" />} onClick={onCopy} />
                </Tooltip>
                {item.canManage ? (
                    <>
                        <Tooltip title="编辑">
                            <Button type="text" size="small" aria-label="编辑提示词" icon={<Pencil className="size-4" />} onClick={onEdit} />
                        </Tooltip>
                        <Tooltip title="删除">
                            <Button type="text" danger size="small" aria-label="删除提示词" icon={<Trash2 className="size-4" />} onClick={onDelete} />
                        </Tooltip>
                    </>
                ) : (
                    <span className="ml-1 text-[11px] opacity-45">只读</span>
                )}
                <span className="ml-auto text-[11px] opacity-40">{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span>
            </div>
        </article>
    );
}
