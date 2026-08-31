export const ASSET_LIBRARY_IDS_DRAG_MIME = "application/x-infinite-canvas-asset-ids";
export const CANVAS_ASSETS_DRAG_MIME = "application/x-infinite-canvas-assets";

export function readDraggedAssetIds(dataTransfer: DataTransfer) {
    try {
        const value = JSON.parse(dataTransfer.getData(ASSET_LIBRARY_IDS_DRAG_MIME)) as { assetIds?: unknown };
        return Array.isArray(value.assetIds) ? value.assetIds.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
}
