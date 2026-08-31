import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { listPromptLibrary } from "@/services/prompt-library";
import type { PromptLibraryScope } from "@/types/prompt-library";

export function usePromptLibraryQuery({ userId, scope, folder = "all", keyword = "", enabled = true }: { userId?: string; scope: PromptLibraryScope; folder?: string; keyword?: string; enabled?: boolean }) {
    const query = useInfiniteQuery({
        queryKey: ["prompt-library", userId || "anonymous", scope, folder, keyword],
        queryFn: ({ pageParam }) => listPromptLibrary({ scope, folder, keyword, cursor: pageParam, limit: 50 }),
        initialPageParam: "",
        getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
        enabled: enabled && Boolean(userId),
    });
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        folders: query.data?.pages[0]?.folders || [],
        total: query.data?.pages[0]?.total || 0,
    };
}
