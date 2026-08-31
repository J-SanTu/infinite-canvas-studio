import { type ReactNode } from "react";
import { ConfigProvider } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "low", label: "1K" },
    { value: "medium", label: "2K" },
    { value: "high", label: "4K" },
];

const aspectOptions = [
    { value: "auto", label: "Auto", width: 1, height: 1, icon: "auto" },
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "2:1", label: "2:1", width: 2, height: 1, icon: "landscape" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "5:4", label: "5:4", width: 5, height: 4, icon: "landscape" },
    { value: "4:5", label: "4:5", width: 4, height: 5, icon: "portrait" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "21:9", label: "21:9", width: 21, height: 9, icon: "landscape" },
    { value: "9:21", label: "9:21", width: 9, height: 21, icon: "portrait" },
];

export const imageQualityOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageAspectOptions = aspectOptions.map((item) => ({ value: item.value, label: item.label }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const resolution = normalizeResolutionValue(config.quality);
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const selectedAspect = findAspectOption(activeSize);
    const selectResolution = (value: string) => {
        onConfigChange("quality", value);
        if (readSizeDimensions(activeSize)) onConfigChange("size", selectedAspect.value);
    };
    const selectAspect = (value: string) => {
        onConfigChange("size", value);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>分辨率</SettingTitle>
                    <div className="grid grid-cols-3 gap-1 rounded-xl border p-1" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                        {resolutionOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                aria-pressed={resolution === item.value}
                                className="h-9 cursor-pointer rounded-lg border text-sm font-semibold transition hover:opacity-80"
                                style={{ background: resolution === item.value ? theme.toolbar.activeBg : "transparent", borderColor: resolution === item.value ? theme.node.activeStroke : "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectResolution(item.value)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                    <div className="grid grid-cols-5 gap-1.5 rounded-xl border p-2" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                        {aspectOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                aria-pressed={selectedAspect.value === item.value}
                                className="flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border text-xs transition hover:opacity-80"
                                style={{ borderColor: selectedAspect.value === item.value ? theme.node.activeStroke : "transparent", background: selectedAspect.value === item.value ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return resolutionOptions.find((item) => item.value === normalizeResolutionValue(value))?.label || value;
}

export function imageSizeLabel(size: string) {
    return findAspectOption(size).label;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") {
        return (
            <span className="grid h-7 w-9 place-items-center rounded-md border border-dashed" style={{ borderColor: color }}>
                <span className="h-3 w-4 rounded-sm border" style={{ borderColor: color }} />
            </span>
        );
    }
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function findAspectOption(size: string) {
    const direct = aspectOptions.find((item) => item.value === size);
    if (direct) return direct;
    const dimensions = readSizeDimensions(size);
    if (!dimensions) return aspectOptions[0];
    const target = dimensions.width / dimensions.height;
    return aspectOptions.slice(1).reduce((best, item) => (Math.abs(item.width / item.height - target) < Math.abs(best.width / best.height - target) ? item : best));
}

function normalizeResolutionValue(value: string) {
    const normalized = value.trim().toLowerCase();
    if (["medium", "hd", "2k"].includes(normalized)) return "medium";
    if (["high", "4k"].includes(normalized)) return "high";
    return "low";
}
