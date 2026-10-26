import type { ReactNode } from "react";
import { PanelsTopLeft, Maximize, HelpCircle, Spline, Magnet, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, Modal, Tooltip } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    hideConnections: boolean; onToggleConnections: () => void; snapToGrid: boolean; onToggleSnap: () => void;
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, hideConnections, onToggleConnections, snapToGrid, onToggleSnap }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <div className={`canvas-navigation ${colorTheme === "dark" ? "is-dark" : ""}`} data-canvas-no-zoom onMouseDown={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}>
            <div className="canvas-bottom-controls" aria-label="画布视图控制">
                <div className="canvas-bottom-pill">
                    <Tooltip title="小地图"><button aria-label={isMiniMapOpen ? "关闭小地图" : "打开小地图"} aria-pressed={isMiniMapOpen} onClick={onToggleMiniMap}><PanelsTopLeft/></button></Tooltip>
                    <Tooltip title={hideConnections ? "显示连线" : "隐藏连线"}><button aria-label={hideConnections ? "显示连线" : "隐藏连线"} aria-pressed={hideConnections} onClick={onToggleConnections}><Spline/></button></Tooltip>
                    <Tooltip title="网格吸附"><button aria-label="网格吸附" aria-pressed={snapToGrid} onClick={onToggleSnap}><Magnet/></button></Tooltip>
                    <Tooltip title="适应画布"><button aria-label="适应画布" onClick={onReset}><Maximize/></button></Tooltip>
                    <Tooltip title={`${Math.round(scale*100)}%`}><input type="range" min="5" max="500" step="1" value={Math.round(scale*100)} onChange={e=>onScaleChange(Number(e.target.value)/100)} aria-label="放大/缩小画布"/></Tooltip>
                </div>
                <Tooltip title="Beta 版本信息"><button className="canvas-control-circle" aria-label="Beta 版本信息" onClick={()=>Modal.info({title:"Santu Beta",content:"当前为本地 Beta。更新请运行固定交付目录中的“安装或更新Beta.command”，画布和素材会保留。"})}><RefreshCw/></button></Tooltip>
                <Tooltip title="帮助与快捷键"><button className="canvas-control-circle" aria-label="帮助与快捷键" onClick={()=>setShortcutsOpen(true)}><HelpCircle/></button></Tooltip>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered styles={{ body: { maxHeight: "calc(100vh - 150px)", overflowY: "auto" } }}>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label="鼠标中键 + 拖动" value="平移视图" />
                    <Shortcut label="Mac 双指" value="平移视图" />
                    <Shortcut label="触控板捏合" value="缩放画布" />
                    <Shortcut label="左键拖动" value="框选多个节点" />
                    <Shortcut label="Shift + 左键拖动" value="追加框选节点" />
                    <Shortcut label="Shift / Ctrl / Cmd + 点击" value="追加选择节点" />
                    <Shortcut label="Ctrl / Cmd + C / V" value="复制 / 粘贴节点" />
                    <Shortcut label="Delete / Backspace" value="删除选中" />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>
            <span className="opacity-60">{value}</span>
        </div>
    );
}
