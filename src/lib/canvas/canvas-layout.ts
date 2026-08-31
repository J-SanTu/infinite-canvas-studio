import type { CanvasNodeData } from "@/types/canvas";

export type CanvasAlignmentAction = "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom";
export type CanvasDistributionAction = "horizontal" | "vertical";
export type CanvasLayoutAction = CanvasAlignmentAction | `distribute-${CanvasDistributionAction}`;

export function getCanvasLayoutSelection(nodes: CanvasNodeData[], selectedIds: ReadonlySet<string>) {
    const explicitlySelected = nodes.filter((node) => selectedIds.has(node.id));
    const topLevelSelection = explicitlySelected.filter((node) => {
        const ownerIds = [node.metadata?.groupId, node.metadata?.batchRootId].filter((id): id is string => Boolean(id));
        return !ownerIds.some((ownerId) => selectedIds.has(ownerId));
    });

    // Two explicitly selected windows must remain alignable even when one owns the other.
    return topLevelSelection.length >= 2 ? topLevelSelection : explicitlySelected;
}

export function layoutCanvasNodes(nodes: CanvasNodeData[], selectedIds: ReadonlySet<string>, action: CanvasLayoutAction) {
    const selection = getCanvasLayoutSelection(nodes, selectedIds);
    const minimum = action.startsWith("distribute-") ? 3 : 2;
    if (selection.length < minimum) return nodes;

    const nextPositions = action.startsWith("distribute-") ? distributeSelection(selection, action === "distribute-horizontal" ? "horizontal" : "vertical") : alignSelection(selection, action as CanvasAlignmentAction);
    const directDeltas = new Map<string, { x: number; y: number }>();
    selection.forEach((node) => {
        const position = nextPositions.get(node.id);
        if (position) directDeltas.set(node.id, { x: position.x - node.position.x, y: position.y - node.position.y });
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const resolvedDeltas = new Map<string, { x: number; y: number } | null>();
    const resolveDelta = (nodeId: string, visiting = new Set<string>()): { x: number; y: number } | null => {
        if (directDeltas.has(nodeId)) return directDeltas.get(nodeId)!;
        if (resolvedDeltas.has(nodeId)) return resolvedDeltas.get(nodeId)!;
        if (visiting.has(nodeId)) return null;
        visiting.add(nodeId);
        const node = nodeById.get(nodeId);
        const ownerIds = [node?.metadata?.groupId, node?.metadata?.batchRootId].filter((id): id is string => Boolean(id));
        for (const ownerId of ownerIds) {
            const delta = resolveDelta(ownerId, visiting);
            if (delta) {
                resolvedDeltas.set(nodeId, delta);
                return delta;
            }
        }
        resolvedDeltas.set(nodeId, null);
        return null;
    };

    let changed = false;
    const result = nodes.map((node) => {
        const delta = resolveDelta(node.id);
        if (!delta || (!delta.x && !delta.y)) return node;
        changed = true;
        return { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } };
    });
    return changed ? result : nodes;
}

function alignSelection(selection: CanvasNodeData[], action: CanvasAlignmentAction) {
    const left = Math.min(...selection.map((node) => node.position.x));
    const right = Math.max(...selection.map((node) => node.position.x + node.width));
    const top = Math.min(...selection.map((node) => node.position.y));
    const bottom = Math.max(...selection.map((node) => node.position.y + node.height));
    const horizontalCenter = (left + right) / 2;
    const verticalCenter = (top + bottom) / 2;

    return new Map(
        selection.map((node) => {
            const position = { ...node.position };
            if (action === "left") position.x = left;
            if (action === "horizontal-center") position.x = horizontalCenter - node.width / 2;
            if (action === "right") position.x = right - node.width;
            if (action === "top") position.y = top;
            if (action === "vertical-center") position.y = verticalCenter - node.height / 2;
            if (action === "bottom") position.y = bottom - node.height;
            return [node.id, position] as const;
        }),
    );
}

function distributeSelection(selection: CanvasNodeData[], axis: CanvasDistributionAction) {
    const horizontal = axis === "horizontal";
    const ordered = [...selection].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y) || a.id.localeCompare(b.id));
    const start = Math.min(...ordered.map((node) => (horizontal ? node.position.x : node.position.y)));
    const end = Math.max(...ordered.map((node) => (horizontal ? node.position.x + node.width : node.position.y + node.height)));
    const totalSize = ordered.reduce((sum, node) => sum + (horizontal ? node.width : node.height), 0);
    const gap = Math.max(0, (end - start - totalSize) / (ordered.length - 1));
    let cursor = start;
    const positions = new Map<string, { x: number; y: number }>();
    ordered.forEach((node) => {
        positions.set(node.id, horizontal ? { x: cursor, y: node.position.y } : { x: node.position.x, y: cursor });
        cursor += (horizontal ? node.width : node.height) + gap;
    });
    return positions;
}
