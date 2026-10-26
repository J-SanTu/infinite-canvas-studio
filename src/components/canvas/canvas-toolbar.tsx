import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip, Modal, Input, Segmented, Switch } from "antd";
import { Plus, Search, FolderOpen, PanelsTopLeft, MessageCircle, History, Settings2, Type, Image as ImageIcon, Video, Music2, Group, Lightbulb, Clapperboard, Upload, Undo2, Redo2, Palette, Trash2, Eraser, X, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Columns3, Rows3, Grid2x2, Layers2 } from "lucide-react";
import { canvasThemes, type CanvasTheme, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useConfigStore } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasAlignmentAction, CanvasDistributionAction } from "@/lib/canvas/canvas-layout";
import "./canvas-navigation.css";
export function CanvasToolbar({
    assetsOpen, libraryPanel, chatOpen, onDismissPanels, nodes, onFocusNode, onToggleChat, onTemplates, onHistory,
    selectedCount,
    layoutItemCount,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddCreative,
    onAddDirector,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onOpenMyAssets,
    onAlign,
    onDistribute,
    onPlacement,
}: {
    assetsOpen: boolean; libraryPanel: "templates" | "history" | null; chatOpen: boolean;
    onDismissPanels: () => void; nodes: CanvasNodeData[]; onFocusNode: (id: string) => void; onToggleChat: () => void; onTemplates: () => void; onHistory: () => void;
    selectedCount: number;
    layoutItemCount: number;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddCreative: () => void;
    onAddDirector: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onOpenMyAssets: () => void;
    onAlign: (action: CanvasAlignmentAction) => void;
    onDistribute: (axis: CanvasDistributionAction) => void;
    onPlacement: (action: "grid" | "stack") => void;
}) {
    const theme = canvasThemes[useThemeStore(s => s.theme)];
    const dark = useThemeStore(s => s.theme) === "dark";
    const [menu, setMenu] = useState<"add" | "settings" | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const wrap = useRef<HTMLDivElement>(null);
    const dockStyle = { background: dark ? "#202021" : "#fff", borderColor: dark ? "#38383a" : "#ddd", color: dark ? "#d4d4d7" : "#444" };
    useEffect(() => {
        const dismiss = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(null); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
        document.addEventListener("pointerdown", dismiss, true); document.addEventListener("keydown", esc);
        return () => { document.removeEventListener("pointerdown", dismiss, true); document.removeEventListener("keydown", esc); };
    }, []);
    const run = (fn: () => void) => { setMenu(null); fn(); };
    const row = (label: string, icon: ReactNode, fn: () => void, desc?: string, disabled=false) => <button key={label} className="canvas-menu-row" disabled={disabled} onClick={() => run(fn)} aria-label={label}><span className="canvas-menu-icon">{icon}</span><span>{label}{desc && <small>{desc}</small>}</span></button>;
    const nav = (label: string, icon: ReactNode, fn: () => void, active=false, plus=false) => <Tooltip title={label} placement="right"><button className={`canvas-rail-button ${plus ? "canvas-rail-add" : ""}`} aria-label={label} aria-pressed={active} onClick={fn}>{icon}</button></Tooltip>;
    const results = nodes.filter(n => (filter === "all" || n.type === filter) && `${n.title} ${n.metadata?.prompt || ""} ${n.type === CanvasNodeType.Text ? n.metadata?.content || "" : ""}`.toLowerCase().includes(query.toLowerCase()));
    return <div ref={wrap} data-canvas-no-zoom className={`canvas-navigation ${dark ? "is-dark" : ""}`} onPointerDown={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()}>
            {layoutItemCount > 1 ? (
                <div
                    role="toolbar"
                    aria-label="节点对齐工具"
                    data-canvas-no-zoom
                    className="thin-scrollbar pointer-events-auto absolute bottom-4 left-[400px] z-50 flex h-12 w-max max-w-[calc(100vw-440px)] items-center gap-1 overflow-x-auto rounded-xl border px-2 shadow-lg backdrop-blur [&>*]:shrink-0"
                    style={dockStyle}
                >
                    <span className="px-2 text-xs font-medium opacity-55">{layoutItemCount} 个节点</span>
                    <Divider theme={theme} />
                    <AlignmentButton label="左对齐" icon={<AlignStartVertical className="size-4" />} onClick={() => onAlign("left")} />
                    <AlignmentButton label="水平居中" icon={<AlignCenterVertical className="size-4" />} onClick={() => onAlign("horizontal-center")} />
                    <AlignmentButton label="右对齐" icon={<AlignEndVertical className="size-4" />} onClick={() => onAlign("right")} />
                    <Divider theme={theme} />
                    <AlignmentButton label="顶部对齐" icon={<AlignStartHorizontal className="size-4" />} onClick={() => onAlign("top")} />
                    <AlignmentButton label="垂直居中" icon={<AlignCenterHorizontal className="size-4" />} onClick={() => onAlign("vertical-center")} />
                    <AlignmentButton label="底部对齐" icon={<AlignEndHorizontal className="size-4" />} onClick={() => onAlign("bottom")} />
                    <Divider theme={theme} />
                    <AlignmentButton label="水平等距分布" icon={<Columns3 className="size-4" />} disabled={layoutItemCount < 3} onClick={() => onDistribute("horizontal")} />
                    <AlignmentButton label="垂直等距分布" icon={<Rows3 className="size-4" />} disabled={layoutItemCount < 3} onClick={() => onDistribute("vertical")} />
                    <Divider theme={theme} />
                    <AlignmentButton label="网格布局" icon={<Grid2x2 className="size-4" />} onClick={() => onPlacement("grid")} />
                    <AlignmentButton label="堆叠" icon={<Layers2 className="size-4" />} onClick={() => onPlacement("stack")} />
                </div>
            ) : null}
        <nav className="canvas-rail" aria-label="画布工具" style={dockStyle}>
            {nav("添加节点", <Plus/>, () => {onDismissPanels();setMenu(menu === "add" ? null : "add");}, menu === "add", true)}
            {nav("搜索节点", <Search/>, () => {onDismissPanels();setMenu(null); setSearchOpen(true);}, searchOpen)}
            {nav("素材库", <FolderOpen/>, () => run(onOpenMyAssets), assetsOpen)}
            {nav("工作流模板", <PanelsTopLeft/>, () => run(onTemplates), libraryPanel === "templates")}
            {nav("画布对话", <MessageCircle/>, () => run(onToggleChat), chatOpen)}
            {nav("生成历史", <History/>, () => run(onHistory), libraryPanel === "history")}
            <span className="canvas-rail-divider"/>
            {nav("画布与本地设置", <Settings2/>, () => {onDismissPanels();setMenu(menu === "settings" ? null : "settings");}, menu === "settings")}
        </nav>
        {menu && <div role="dialog" aria-label={menu === "add" ? "添加节点菜单" : "画布设置菜单"} className="canvas-rail-menu" style={dockStyle}>
            {menu === "add" ? <>
                <p className="canvas-menu-section">添加节点</p>
                {row("文本",<Type/>,onAddText,"脚本、广告文案、品牌文字")}
                {row("图片",<ImageIcon/>,onAddImage,"宣传图、海报、封面")}
                {row("视频",<Video/>,onAddVideo,"宣传片、动画、短片")}
                {row("音频",<Music2/>,onAddAudio,"音乐、配音、音效")}
                <p className="canvas-menu-section">创作工具</p>
                {row("生成配置",<Settings2/>,onAddConfig)}
                {row("创意策划",<Lightbulb/>,onAddCreative)}
                {row("导演台",<Clapperboard/>,onAddDirector)}
                {row("组",<Group/>,onAddGroup)}
                <p className="canvas-menu-section">添加素材</p>
                {row("上传素材",<Upload/>,onUpload,"图片 / 视频 / 音频")}
            </> : <>
                <p className="canvas-menu-section">编辑</p>
                {row("撤销",<Undo2/>,onUndo,"⌘ Z",!canUndo)}
                {row("重做",<Redo2/>,onRedo,"⌘ ⇧ Z",!canRedo)}
                {row("取消选择",<X/>,onDeselect)}
                {row("删除选中",<Trash2/>,onDelete,undefined,!selectedCount)}
                <p className="canvas-menu-section">画布外观</p>
                <Segmented block value={backgroundMode} options={[{label:"点阵",value:"dots"},{label:"网格",value:"lines"},{label:"纯色",value:"blank"}]} onChange={v=>onBackgroundModeChange(v as CanvasBackgroundMode)}/>
                <label className="canvas-setting-row">图片信息 <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange}/></label>
                {row("本地设置",<Settings2/>,()=>useConfigStore.getState().openConfigDialog(false,"apis"))}
                {row("清空画布",<Eraser/>,onClear)}
            </>}
        </div>}
        <Modal title="搜索节点" open={searchOpen} onCancel={()=>setSearchOpen(false)} footer={null} width={560} centered>
            <div data-canvas-no-zoom className="canvas-node-search">
                <Input autoFocus prefix={<Search size={16}/>} placeholder="搜索标题、提示词或文本" value={query} onChange={e=>setQuery(e.target.value)}/>
                <div className="canvas-search-filters">{[["all","全部"],["image","图片"],["video","视频"],["text","文本"],["audio","音频"],["group","组"]].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
                <div className="canvas-search-results">{results.length ? results.map(n=><button key={n.id} onClick={()=>{onFocusNode(n.id);setSearchOpen(false);}}><strong>{n.title || "未命名节点"}</strong><small>{n.metadata?.prompt || (n.type === "text" ? n.metadata?.content : "") || "无提示词"}</small></button>) : <p>没有匹配的节点</p>}</div>
            </div>
        </Modal>
    </div>;
}
function Divider({theme}:{theme:CanvasTheme}) { return <span className="mx-1 h-5 w-px" style={{background:theme.toolbar.border}}/>; }
function AlignmentButton({label,icon,disabled=false,onClick}:{label:string;icon:ReactNode;disabled?:boolean;onClick:()=>void}) { return <Tooltip title={label}><Button type="text" aria-label={label} disabled={disabled} icon={icon} onClick={onClick}/></Tooltip>; }
