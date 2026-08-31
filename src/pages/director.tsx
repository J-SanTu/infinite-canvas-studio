import { useCallback } from "react";

import { DirectorWorkspace } from "@/components/director/director-workspace";
import { useAssetStore } from "@/stores/use-asset-store";
import type { Asset } from "@/stores/use-asset-store";

export default function DirectorPage() {
    const handleExport = useCallback(({ asset }: { asset: Asset }) => {
        useAssetStore.setState((state) => ({ assets: [asset, ...state.assets.filter((item) => item.id !== asset.id)] }));
    }, []);

    return (
        <main className="h-full min-h-0 overflow-hidden bg-[#171715]">
            <DirectorWorkspace nodeId="standalone-director" onExport={handleExport} />
        </main>
    );
}
