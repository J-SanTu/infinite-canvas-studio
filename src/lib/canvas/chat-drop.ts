export type CanvasChatDropTarget = {
    contains: (x: number, y: number) => boolean;
    hover: (ids: string[] | null) => void;
    drop: (ids: string[]) => void;
};
