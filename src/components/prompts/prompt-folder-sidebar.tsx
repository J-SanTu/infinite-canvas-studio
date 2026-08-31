import { Button, Dropdown, Tooltip } from "antd";
import { Folder, FolderOpen, Images, MoreHorizontal } from "lucide-react";

import type { PromptLibraryFolder } from "@/types/prompt-library";

export const PROMPT_LIBRARY_DRAG_MIME = "application/x-infinite-canvas-prompt-items";

export function PromptFolderSidebar({
    folders,
    activeFolder,
    allCount,
    onSelect,
    onEdit,
    onDelete,
    onDropItems,
}: {
    folders: PromptLibraryFolder[];
    activeFolder: string;
    allCount: number;
    onSelect: (folderId: string) => void;
    onEdit: (folder: PromptLibraryFolder) => void;
    onDelete: (folder: PromptLibraryFolder) => void;
    onDropItems: (itemIds: string[], folderId: string | null) => void;
}) {
    const readDrop = (event: React.DragEvent) => {
        try {
            const parsed = JSON.parse(event.dataTransfer.getData(PROMPT_LIBRARY_DRAG_MIME));
            return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
        } catch {
            return [];
        }
    };
    const row = (id: string, label: string, count: number | null, icon: React.ReactNode, folder?: PromptLibraryFolder) => (
        <div
            key={id}
            role="button"
            tabIndex={0}
            className={`group flex h-10 items-center gap-2 rounded-md px-2 text-sm transition ${activeFolder === id ? "bg-stone-200 font-medium text-stone-950 dark:bg-stone-800 dark:text-white" : "hover:bg-stone-100 dark:hover:bg-stone-900"}`}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(id);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault();
                const ids = readDrop(event);
                if (ids.length) onDropItems(ids, id === "unfiled" ? null : folder?.id || null);
            }}
        >
            <span className="opacity-60">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {typeof count === "number" ? <span className="text-xs opacity-40">{count}</span> : null}
            {folder?.canManage ? (
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "edit", label: "重命名" },
                            { key: "delete", label: "删除", danger: true },
                        ],
                        onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            key === "delete" ? onDelete(folder) : onEdit(folder);
                        },
                    }}
                >
                    <Tooltip title="文件夹操作">
                        <Button
                            type="text"
                            size="small"
                            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={`${folder.name}文件夹操作`}
                            icon={<MoreHorizontal className="size-4" />}
                            onClick={(event) => event.stopPropagation()}
                        />
                    </Tooltip>
                </Dropdown>
            ) : null}
        </div>
    );

    return (
        <aside className="min-h-0 overflow-y-auto border-r p-3" style={{ borderColor: "rgba(120,113,108,.2)" }}>
            {row("all", "全部提示词", allCount, <Images className="size-4" />)}
            {row("unfiled", "未分类", null, <FolderOpen className="size-4" />)}
            <div className="mb-2 mt-5 px-2 text-xs font-medium opacity-45">文件夹</div>
            <div className="space-y-1">{folders.map((folder) => row(folder.id, folder.name, folder.count, <Folder className="size-4" />, folder))}</div>
        </aside>
    );
}
