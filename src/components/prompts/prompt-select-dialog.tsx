import { useEffect, useState } from "react";
import { Button, Empty, Input, Modal, Select, Spin, Tag } from "antd";
import { Check, ImageOff, Search } from "lucide-react";

import { usePromptLibraryQuery } from "./use-prompt-library-query";
import { usePromptLibraryStore } from "@/stores/use-prompt-library-store";
import { useUserStore } from "@/stores/use-user-store";

export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const user = useUserStore((state) => state.user);
    const scope = "personal" as const;
    const resetForUser = usePromptLibraryStore((state) => state.resetForUser);
    const [folder, setFolder] = useState("all");
    const [keyword, setKeyword] = useState("");
    const { query, items, folders } = usePromptLibraryQuery({ userId: user?.id, scope, folder, keyword, enabled: open });

    useEffect(() => {
        if (user?.id) resetForUser(user.id);
    }, [resetForUser, user?.id]);
    const selectPrompt = (prompt: string) => {
        onSelect(prompt);
        onOpenChange(false);
    };

    return (
        <Modal title="选择提示词" open={open} onCancel={() => onOpenChange(false)} footer={null} width={1040} centered>
            <div data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                <div className="flex flex-wrap items-center gap-3">
                    <Select className="w-48" value={folder} options={[{ label: "全部提示词", value: "all" }, { label: "未分类", value: "unfiled" }, ...folders.map((item) => ({ label: item.name, value: item.id }))]} onChange={setFolder} />
                    <Input className="min-w-60 flex-1" prefix={<Search className="size-4 opacity-45" />} allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题、提示词、标签或创建者" />
                </div>
                <div className="thin-scrollbar mt-5 max-h-[560px] overflow-y-auto pr-2" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                    {query.isLoading ? (
                        <div className="grid h-40 place-items-center">
                            <Spin />
                        </div>
                    ) : null}
                    {!query.isLoading && items.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {items.map((item) => (
                                <PromptChoiceCard key={item.id} item={item} onSelect={() => selectPrompt(item.prompt)} />
                            ))}
                        </div>
                    ) : null}
                    {!query.isLoading && !items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的提示词" className="py-12" /> : null}
                    {query.hasNextPage ? (
                        <div className="py-5 text-center">
                            <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                                加载更多
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </Modal>
    );
}

function PromptChoiceCard({ item, onSelect }: { item: import("@/types/prompt-library").PromptLibraryItem; onSelect: () => void }) {
    const [failed, setFailed] = useState(false);
    return (
        <article className="overflow-hidden rounded-md border border-stone-200 bg-background dark:border-stone-800">
            <button type="button" className="block w-full text-left" onClick={onSelect}>
                <div className="aspect-[4/3] overflow-hidden bg-stone-100 dark:bg-stone-900">
                    {failed ? (
                        <span className="grid h-full place-items-center text-stone-400">
                            <ImageOff className="size-8" />
                        </span>
                    ) : (
                        <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" onError={() => setFailed(true)} />
                    )}
                </div>
                <div className="p-3">
                    <div className="truncate text-sm font-semibold">{item.title}</div>
                    <p className="mt-2 line-clamp-3 min-h-[60px] text-xs leading-5 opacity-65">{item.prompt}</p>
                    <div className="mt-3 flex min-h-5 flex-wrap gap-1">
                        {item.tags.slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </div>
            </button>
            <div className="border-t p-2 dark:border-stone-800">
                <Button block type="primary" size="small" icon={<Check className="size-4" />} onClick={onSelect}>
                    使用此提示词
                </Button>
            </div>
        </article>
    );
}
