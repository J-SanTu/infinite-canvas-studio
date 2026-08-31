import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { usePromptLibraryStore } from "@/stores/use-prompt-library-store";
import { useUserStore } from "@/stores/use-user-store";

export function PromptLibrarySessionSync() {
    const queryClient = useQueryClient();
    const user = useUserStore((state) => state.user);
    const initialized = useUserStore((state) => state.initialized);
    const previousUserId = useRef("");

    useEffect(() => {
        if (!initialized) return;
        const nextUserId = user?.id || "";
        if (previousUserId.current && previousUserId.current !== nextUserId) queryClient.removeQueries({ queryKey: ["prompt-library"] });
        if (nextUserId) usePromptLibraryStore.getState().resetForUser(nextUserId);
        else {
            queryClient.removeQueries({ queryKey: ["prompt-library"] });
            usePromptLibraryStore.getState().clearSession();
        }
        previousUserId.current = nextUserId;
    }, [initialized, queryClient, user?.id]);

    return null;
}
