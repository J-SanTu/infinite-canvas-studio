import { Clapperboard, ClipboardList, FileText, ImagePlus, Images, Maximize2, Music2, Settings2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "audio",
        label: "音频创作台",
        icon: Music2,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "director",
        label: "导演台",
        icon: Clapperboard,
    },
    {
        slug: "tasks",
        label: "任务中心",
        icon: ClipboardList,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
    {
        slug: "config",
        label: "配置",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
