import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, Modal, Tooltip } from "antd";
import { LocateFixed, WandSparkles, X } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";
import { resolveOutpaintLayout, type ImageOutpaintParams } from "@/lib/canvas/canvas-image-data";

export type CanvasImageOutpaintParams = ImageOutpaintParams & {
    prompt: string;
};

const ratioOptions = [
    { label: "1:1", value: "1:1" },
    { label: "4:3", value: "4:3" },
    { label: "3:2", value: "3:2" },
    { label: "16:9", value: "16:9" },
    { label: "21:9", value: "21:9" },
    { label: "3:4", value: "3:4" },
    { label: "2:3", value: "2:3" },
    { label: "9:16", value: "9:16" },
];

const defaultPrompt = "自然扩展画面四周，延续原图的主体、场景、光线、透视、材质和色彩，不改变框内原图内容。";
const centeredPosition = { x: 0.5, y: 0.5 };

export function CanvasNodeOutpaintDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageOutpaintParams) => void }) {
    const previewRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; position: { x: number; y: number }; rangeX: number; rangeY: number } | null>(null);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [ratio, setRatio] = useState("16:9");
    const [position, setPosition] = useState(centeredPosition);
    const [previewBounds, setPreviewBounds] = useState({ width: 720, height: 520 });
    const [prompt, setPrompt] = useState(defaultPrompt);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open) return;
        setPrompt(defaultPrompt);
        setPosition(centeredPosition);
        setError("");
        void readImageMeta(dataUrl).then((meta) => {
            setImage(meta);
            setRatio(closestRatio(meta.width, meta.height));
        });
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open || !previewRef.current) return;
        const element = previewRef.current;
        const updateBounds = () => {
            const bounds = element.getBoundingClientRect();
            setPreviewBounds({ width: bounds.width, height: bounds.height });
        };
        updateBounds();
        const observer = new ResizeObserver(updateBounds);
        observer.observe(element);
        return () => observer.disconnect();
    }, [open]);

    const targetLayout = useMemo(() => {
        if (!image) return null;
        try {
            return resolveOutpaintLayout(image.width, image.height, ratio);
        } catch {
            return null;
        }
    }, [image, ratio]);
    const previewFrame = useMemo(() => fitFrame(previewBounds.width - 40, previewBounds.height - 40, targetLayout ? targetLayout.width / targetLayout.height : readRatio(ratio)), [previewBounds, ratio, targetLayout]);
    const sourceStyle = useMemo(() => {
        if (!targetLayout) return {};
        const availableX = targetLayout.width - targetLayout.sourceWidth;
        const availableY = targetLayout.height - targetLayout.sourceHeight;
        return {
            left: `${((availableX * position.x) / targetLayout.width) * 100}%`,
            top: `${((availableY * position.y) / targetLayout.height) * 100}%`,
            width: `${(targetLayout.sourceWidth / targetLayout.width) * 100}%`,
            height: `${(targetLayout.sourceHeight / targetLayout.height) * 100}%`,
        };
    }, [position, targetLayout]);

    const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const frame = event.currentTarget.parentElement?.getBoundingClientRect();
        const source = event.currentTarget.getBoundingClientRect();
        if (!frame) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            position,
            rangeX: Math.max(0, frame.width - source.width),
            rangeY: Math.max(0, frame.height - source.height),
        };
    };
    const moveSource = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setPosition({
            x: drag.rangeX ? clampUnit(drag.position.x + (event.clientX - drag.startX) / drag.rangeX) : 0.5,
            y: drag.rangeY ? clampUnit(drag.position.y + (event.clientY - drag.startY) / drag.rangeY) : 0.5,
        });
    };
    const endMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const submit = () => {
        const nextPrompt = prompt.trim();
        if (!nextPrompt) {
            setError("请输入扩图要求");
            return;
        }
        if (!targetLayout) {
            setError("当前图片无法创建扩图画布");
            return;
        }
        onConfirm({ ratio, prompt: nextPrompt, positionX: position.x, positionY: position.y });
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={1180} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(480px,1fr)_340px]">
                <div ref={previewRef} className="relative flex h-[min(62vh,620px)] min-h-[380px] items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-[#090909] p-5 dark:border-white/10">
                    <Tooltip title="恢复居中">
                        <Button aria-label="恢复居中" shape="circle" type="text" className="!absolute !right-3 !top-3 !z-20 !text-white" icon={<LocateFixed className="size-4" />} onClick={() => setPosition(centeredPosition)} />
                    </Tooltip>
                    <div
                        className="relative overflow-visible border border-white/80 bg-black shadow-[0_20px_60px_rgba(0,0,0,.45)]"
                        style={{ width: previewFrame.width, height: previewFrame.height }}
                    >
                        <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(rgba(255,255,255,.25)_1px,transparent_1px)] [background-size:24px_24px]" />
                        <div
                            className="absolute cursor-grab touch-none overflow-hidden border border-white/90 bg-black shadow-[0_0_36px_rgba(255,255,255,.14)] active:cursor-grabbing"
                            style={sourceStyle}
                            onPointerDown={startMove}
                            onPointerMove={moveSource}
                            onPointerUp={endMove}
                            onPointerCancel={endMove}
                        >
                            <img src={dataUrl} alt="扩图原图" className="pointer-events-none h-full w-full select-none object-fill" draggable={false} />
                        </div>
                            <FrameHandle className="left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" />
                            <FrameHandle className="bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" />
                            <FrameHandle className="left-0 top-1/2 -translate-x-1/2 -translate-y-1/2" />
                            <FrameHandle className="right-0 top-1/2 -translate-y-1/2 translate-x-1/2" />
                            <Corner className="left-0 top-0" />
                            <Corner className="right-0 top-0 rotate-90" />
                            <Corner className="bottom-0 right-0 rotate-180" />
                            <Corner className="bottom-0 left-0 -rotate-90" />
                    </div>
                </div>

                <div className="flex min-h-[420px] flex-col gap-5">
                    <div>
                        <h2 className="text-xl font-semibold">扩图</h2>
                        <div className="mt-2 text-sm opacity-60">
                            {image && targetLayout ? `原图 ${image.width} x ${image.height} · 输出 ${targetLayout.width} x ${targetLayout.height}` : "读取中"}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">目标比例</div>
                        <div className="grid grid-cols-4 gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/5">
                            {ratioOptions.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={ratio === option.value}
                                    className="h-9 rounded-md border text-sm transition hover:opacity-80"
                                    style={{ borderColor: ratio === option.value ? "currentColor" : "transparent", background: ratio === option.value ? "rgba(127,127,127,.18)" : "transparent" }}
                                    onClick={() => setRatio(option.value)}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">扩图要求</div>
                        <Input.TextArea
                            rows={7}
                            value={prompt}
                            status={error && !prompt.trim() ? "error" : undefined}
                            placeholder="描述四周需要自然补全的环境、光线和构图"
                            onChange={(event) => {
                                setPrompt(event.target.value);
                                setError("");
                            }}
                        />
                        {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}
                    </div>

                    <div className="mt-auto flex items-center justify-end gap-2">
                        <Button icon={<X className="size-4" />} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" icon={<WandSparkles className="size-4" />} onClick={submit}>
                            生成扩图
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function FrameHandle({ className }: { className: string }) {
    return <div className={`absolute h-1.5 w-16 rounded-full bg-white ${className}`} />;
}

function Corner({ className }: { className: string }) {
    return (
        <div className={`absolute h-12 w-12 border-white ${className}`}>
            <div className="absolute left-0 top-0 h-1 w-12 bg-white" />
            <div className="absolute left-0 top-0 h-12 w-1 bg-white" />
        </div>
    );
}

function closestRatio(width: number, height: number) {
    const sourceRatio = width / height;
    return ratioOptions.reduce((best, option) => {
        const distance = Math.abs(readRatio(option.value) - sourceRatio);
        const bestDistance = Math.abs(readRatio(best.value) - sourceRatio);
        return distance < bestDistance ? option : best;
    }).value;
}

function readRatio(value: string) {
    const [width, height] = value.split(":").map(Number);
    return (width || 1) / (height || 1);
}

function fitFrame(maxWidth: number, maxHeight: number, ratio: number) {
    const safeWidth = Math.max(160, maxWidth);
    const safeHeight = Math.max(220, maxHeight);
    if (safeWidth / safeHeight > ratio) return { width: safeHeight * ratio, height: safeHeight };
    return { width: safeWidth, height: safeWidth / ratio };
}

function clampUnit(value: number) {
    return Math.max(0, Math.min(1, value));
}
