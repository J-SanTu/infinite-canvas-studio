import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasViewportSize = { width: number; height: number };
export type CanvasVisibilityOptions = { padding?: number; isHidden?: (node: CanvasNodeData) => boolean };

export function getVisibleCanvasNodes(nodes: CanvasNodeData[], viewport: ViewportTransform, size: CanvasViewportSize, options: CanvasVisibilityOptions = {}) {
    const padding = options.padding ?? 280;
    const scale = Math.max(viewport.k, 0.05);
    const viewLeft = -viewport.x / scale - padding;
    const viewTop = -viewport.y / scale - padding;
    const viewRight = viewLeft + size.width / scale + padding * 2;
    const viewBottom = viewTop + size.height / scale + padding * 2;
    const isHidden = options.isHidden || (() => false);

    return nodes.filter(
        (node) =>
            !isHidden(node) &&
            node.position.x + node.width > viewLeft &&
            node.position.x < viewRight &&
            node.position.y + node.height > viewTop &&
            node.position.y < viewBottom,
    );
}

export function getVisibleCanvasConnections(connections: CanvasConnection[], nodesById: ReadonlyMap<string, CanvasNodeData>, visibleNodeIds: ReadonlySet<string>, isHiddenEndpoint: (node: CanvasNodeData) => boolean, highlightedConnectionIds: ReadonlySet<string> = new Set()) {
    return connections.filter((connection) => {
        const from = nodesById.get(connection.fromNodeId);
        const to = nodesById.get(connection.toNodeId);
        if (!from || !to || isHiddenEndpoint(from) || isHiddenEndpoint(to)) return false;
        return visibleNodeIds.has(from.id) || visibleNodeIds.has(to.id) || highlightedConnectionIds.has(connection.id);
    });
}
