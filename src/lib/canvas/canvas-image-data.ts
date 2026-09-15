export type ImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ImageAngleTransform = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";

export const MAX_UPSCALE_LONG_EDGE = 8192;
const IMAGE_SIZE_STEP = 16;
const OUTPAINT_MAX_PIXELS = 8294400;
const OUTPAINT_SOURCE_OCCUPANCY = 0.68;

export type ImageUpscaleParams = {
    targetLongEdge: number;
    algorithm: ImageUpscaleAlgorithm;
};

export type ImageExactResizeParams = {
    width: number;
    height: number;
    algorithm?: ImageUpscaleAlgorithm;
};

export type ImageOutpaintParams = {
    ratio: string;
    positionX?: number;
    positionY?: number;
};

export type ImageOutpaintLayout = {
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
};

export type ImageOutpaintResult = {
    imageDataUrl: string;
    maskDataUrl: string;
    width: number;
    height: number;
    sourceRect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
};

export type ImageSplitParams = {
    rows: number;
    columns: number;
    horizontalLines?: number[];
    verticalLines?: number[];
};

export type ImageSplitPiece = {
    row: number;
    column: number;
    dataUrl: string;
};

export async function cropDataUrl(dataUrl: string, crop?: ImageCropRect) {
    const image = await loadImage(dataUrl);
    if (crop) {
        return drawCrop(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), Math.ceil(crop.width * image.width), Math.ceil(crop.height * image.height));
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return drawCrop(image, sx, sy, size, size);
}

export async function splitDataUrl(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const image = await loadImage(dataUrl);
    const xCuts = buildSplitCuts(params.verticalLines, image.width, Math.max(1, Math.floor(params.columns)));
    const yCuts = buildSplitCuts(params.horizontalLines, image.height, Math.max(1, Math.floor(params.rows)));
    const pieces: ImageSplitPiece[] = [];

    for (let row = 0; row < yCuts.length - 1; row += 1) {
        const sy = yCuts[row];
        const sh = yCuts[row + 1] - sy;
        for (let column = 0; column < xCuts.length - 1; column += 1) {
            const sx = xCuts[column];
            const sw = xCuts[column + 1] - sx;
            pieces.push({ row, column, dataUrl: drawCrop(image, sx, sy, sw, sh) });
        }
    }

    return pieces;
}

function buildSplitCuts(lines: number[] | undefined, size: number, count: number) {
    if (!lines?.length) return Array.from({ length: count + 1 }, (_, index) => Math.floor((index * size) / count));
    return [0, ...lines.map((line) => Math.round(line * size)).filter((line) => line > 0 && line < size).sort((a, b) => a - b), size];
}

export async function transformAngleDataUrl(dataUrl: string, params: ImageAngleTransform) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const padding = Math.round(Math.max(image.width, image.height) * 0.18);
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const horizontal = params.horizontalAngle / 60;
    const pitch = params.pitchAngle / 45;
    const distanceScale = 1.12 - params.cameraDistance * 0.035;
    const wideScale = params.wideAngle ? 0.88 : 1;
    const scale = Math.max(0.64, Math.min(1.1, distanceScale * wideScale));
    const width = image.width * scale * (1 - Math.abs(horizontal) * 0.28);
    const height = image.height * scale * (1 - Math.abs(pitch) * 0.18);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const skewX = horizontal * image.width * 0.18;
    const skewY = pitch * image.height * 0.12;
    const x = cx - width / 2 + horizontal * padding * 0.5;
    const y = cy - height / 2 + pitch * padding * 0.45;

    context.save();
    context.setTransform(1, pitch * 0.08, horizontal * -0.1, 1, 0, 0);
    context.drawImage(image, x + skewX, y + skewY, width, height);
    context.restore();

    if (params.wideAngle) {
        const gradient = context.createRadialGradient(cx, cy, Math.min(canvas.width, canvas.height) * 0.2, cx, cy, Math.max(canvas.width, canvas.height) * 0.62);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.18)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL("image/png");
}

export async function upscaleDataUrl(dataUrl: string, params: ImageUpscaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
    return params.algorithm === "high" ? drawStepUpscale(image, width, height) : drawResize(image, image.width, image.height, width, height, params.algorithm);
}

export async function resizeDataUrlToExactSize(dataUrl: string, params: ImageExactResizeParams) {
    const image = await loadImage(dataUrl);
    const width = Math.max(1, Math.round(params.width));
    const height = Math.max(1, Math.round(params.height));
    return drawCoverResize(image, width, height, params.algorithm || "high");
}

export async function outpaintDataUrl(dataUrl: string, params: ImageOutpaintParams): Promise<ImageOutpaintResult> {
    const image = await loadImage(dataUrl);
    const layout = resolveOutpaintLayout(image.width, image.height, params.ratio);
    const x = Math.round((layout.width - layout.sourceWidth) * clampUnit(params.positionX ?? 0.5));
    const y = Math.round((layout.height - layout.sourceHeight) * clampUnit(params.positionY ?? 0.5));

    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = layout.width;
    imageCanvas.height = layout.height;
    const imageContext = imageCanvas.getContext("2d");
    if (!imageContext) return { imageDataUrl: dataUrl, maskDataUrl: dataUrl, width: image.width, height: image.height, sourceRect: { x: 0, y: 0, width: image.width, height: image.height } };
    imageContext.clearRect(0, 0, layout.width, layout.height);
    imageContext.drawImage(image, x, y, layout.sourceWidth, layout.sourceHeight);

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = layout.width;
    maskCanvas.height = layout.height;
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) return { imageDataUrl: imageCanvas.toDataURL("image/png"), maskDataUrl: dataUrl, width: layout.width, height: layout.height, sourceRect: { x, y, width: layout.sourceWidth, height: layout.sourceHeight } };
    maskContext.clearRect(0, 0, layout.width, layout.height);
    maskContext.fillStyle = "#ffffff";
    maskContext.fillRect(x, y, layout.sourceWidth, layout.sourceHeight);

    return {
        imageDataUrl: imageCanvas.toDataURL("image/png"),
        maskDataUrl: maskCanvas.toDataURL("image/png"),
        width: layout.width,
        height: layout.height,
        sourceRect: { x, y, width: layout.sourceWidth, height: layout.sourceHeight },
    };
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const longEdge = Math.max(1, width, height);
    const target = Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, Math.round(targetLongEdge)));
    const scale = target / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function resolveOutpaintSize(width: number, height: number, ratio: string) {
    const layout = resolveOutpaintLayout(width, height, ratio);
    return { width: layout.width, height: layout.height };
}

export function resolveOutpaintLayout(width: number, height: number, ratio: string): ImageOutpaintLayout {
    const [ratioWidth, ratioHeight] = parseRatio(ratio);
    const targetRatio = ratioWidth / ratioHeight;
    const sourceWidth = Math.max(1, Math.round(width));
    const sourceHeight = Math.max(1, Math.round(height));
    const minimumWidth = sourceWidth / OUTPAINT_SOURCE_OCCUPANCY;
    const minimumHeight = sourceHeight / OUTPAINT_SOURCE_OCCUPANCY;
    let rawWidth: number;
    let rawHeight: number;

    if (minimumWidth / minimumHeight > targetRatio) {
        rawWidth = minimumWidth;
        rawHeight = rawWidth / targetRatio;
    } else {
        rawHeight = minimumHeight;
        rawWidth = rawHeight * targetRatio;
    }

    let targetWidth = roundUpToStep(rawWidth, IMAGE_SIZE_STEP);
    let targetHeight = roundUpToStep(rawHeight, IMAGE_SIZE_STEP);
    if (targetWidth * targetHeight > OUTPAINT_MAX_PIXELS) {
        const bounded = fitRatioToPixelBudget(targetRatio, OUTPAINT_MAX_PIXELS, IMAGE_SIZE_STEP);
        targetWidth = bounded.width;
        targetHeight = bounded.height;
    }

    const sourceScale = Math.min(1, targetWidth / rawWidth, targetHeight / rawHeight);
    return {
        width: targetWidth,
        height: targetHeight,
        sourceWidth: Math.min(targetWidth, Math.max(1, Math.round(sourceWidth * sourceScale))),
        sourceHeight: Math.min(targetHeight, Math.max(1, Math.round(sourceHeight * sourceScale))),
    };
}

function roundUpToStep(value: number, step: number) {
    return Math.max(step, Math.ceil(value / step) * step);
}

function clampUnit(value: number) {
    return Math.max(0, Math.min(1, value));
}

function fitRatioToPixelBudget(ratio: number, maxPixels: number, step: number) {
    const landscape = ratio >= 1;
    let longSide = Math.max(step, Math.floor(Math.sqrt(maxPixels * (landscape ? ratio : 1 / ratio)) / step) * step);
    let shortSide = Math.max(step, Math.round(longSide / (landscape ? ratio : 1 / ratio) / step) * step);
    while (longSide * shortSide > maxPixels && shortSide > step) shortSide -= step;
    return landscape ? { width: longSide, height: shortSide } : { width: shortSide, height: longSide };
}

function parseRatio(ratio: string) {
    const match = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    const width = Number(match?.[1]) || 1;
    const height = Number(match?.[2]) || 1;
    return [Math.max(0.1, width), Math.max(0.1, height)] as const;
}

function drawCrop(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const context = canvas.getContext("2d");
    if (!context) return image.src;
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

function drawStepUpscale(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
        const nextWidth = sourceWidth * 2;
        const nextHeight = sourceHeight * 2;
        const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
        source = next;
        sourceWidth = nextWidth;
        sourceHeight = nextHeight;
    }

    return drawResize(source, sourceWidth, sourceHeight, width, height, "high");
}

function drawResize(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    return drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, algorithm).toDataURL("image/png");
}

function drawCoverResize(image: HTMLImageElement, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const sourceRatio = image.width / Math.max(1, image.height);
    const targetRatio = width / Math.max(1, height);
    let sx = 0;
    let sy = 0;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    if (sourceRatio > targetRatio) {
        sourceWidth = Math.max(1, Math.round(image.height * targetRatio));
        sx = Math.max(0, Math.round((image.width - sourceWidth) / 2));
    } else if (sourceRatio < targetRatio) {
        sourceHeight = Math.max(1, Math.round(image.width / targetRatio));
        sy = Math.max(0, Math.round((image.height - sourceHeight) / 2));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return canvas.toDataURL("image/png");
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas.toDataURL("image/png");
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = dataUrl;
    });
}
