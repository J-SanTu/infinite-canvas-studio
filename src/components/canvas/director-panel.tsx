import { Modal } from "antd";

import { DirectorWorkspace } from "@/components/director/director-workspace";
import type { Asset } from "@/stores/use-asset-store";
import type { GenerationRun } from "@/services/api/generation-runs";
import type { DirectorCanvasReference } from "@/lib/director/director-project";

export function DirectorPanel({ nodeId, canvasProjectId, references, open, onClose, onExport }: { nodeId: string; canvasProjectId?: string; references?: DirectorCanvasReference[]; open: boolean; onClose: () => void; onExport?: (result: { asset: Asset; run: GenerationRun; blob: Blob }) => void | Promise<void> }) {
    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width="min(96vw, 1440px)"
            centered
            destroyOnHidden
            title="Santu Director 预演"
            styles={{ body: { height: "min(84vh, 860px)", padding: 0, overflow: "hidden" } }}
        >
            <DirectorWorkspace key={nodeId} nodeId={nodeId} canvasProjectId={canvasProjectId} references={references} onExport={onExport} />
        </Modal>
    );
}
