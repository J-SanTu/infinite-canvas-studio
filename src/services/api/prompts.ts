export type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    sourceUrl?: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
};

export const ALL_PROMPTS_OPTION = "全部";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

const LOCAL_PROMPT_COVER =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'%3E%3Crect width='800' height='600' fill='%23262523'/%3E%3Cpath d='M80 120h640v360H80z' fill='%23332f2d' stroke='%23615b55' stroke-width='6'/%3E%3Ccircle cx='250' cy='275' r='86' fill='%237c8f6a'/%3E%3Cpath d='M360 390l92-112 74 82 58-58 136 88z' fill='%23d8c8aa'/%3E%3Ctext x='80' y='540' fill='%23ddd6cc' font-size='36' font-family='Arial'%3ESantu Canvas Prompt%3C/text%3E%3C/svg%3E";

const localPrompts: Prompt[] = [
    {
        id: "santu-local-0001",
        title: "产品主视觉",
        coverUrl: LOCAL_PROMPT_COVER,
        prompt: "为产品生成一张清晰、可信、现代的主视觉图。画面突出产品核心对象，构图简洁，光线自然，背景干净，适合用于官网首屏或项目封面。",
        tags: ["产品", "主视觉"],
        category: "santu-local",
        preview: "",
        createdAt: "2026-07-15",
        updatedAt: "2026-07-15",
    },
    {
        id: "santu-local-0002",
        title: "电商详情图",
        coverUrl: LOCAL_PROMPT_COVER,
        prompt: "生成一张电商详情页商品展示图，突出商品材质、结构和使用场景，保留真实比例，画面明亮，背景不喧宾夺主，适合移动端详情页浏览。",
        tags: ["电商", "商品", "详情页"],
        category: "santu-local",
        preview: "",
        createdAt: "2026-07-15",
        updatedAt: "2026-07-15",
    },
    {
        id: "santu-local-0003",
        title: "参考图风格延展",
        coverUrl: LOCAL_PROMPT_COVER,
        prompt: "参考输入图片的主体、材质和色彩，生成同一系列的延展画面。保持品牌调性一致，避免改变核心结构，输出适合横向方案对比的图片。",
        tags: ["参考图", "风格延展", "系列化"],
        category: "santu-local",
        preview: "",
        createdAt: "2026-07-15",
        updatedAt: "2026-07-15",
    },
];

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}): Promise<PromptListResponse> {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const withoutTagFilter = filterPrompts(localPrompts, { keyword: normalizedKeyword, category, tags: [] });
    const filtered = filterPrompts(localPrompts, { keyword: normalizedKeyword, category, tags: tag });

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories: [ALL_PROMPTS_OPTION, ...collectCategories(localPrompts)],
        total: filtered.length,
    };
}

function filterPrompts(items: Prompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

function collectTags(items: Prompt[]) {
    return [ALL_PROMPTS_OPTION, ...Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean)))];
}

function collectCategories(items: Prompt[]) {
    return Array.from(new Set(items.map((item) => item.category).filter(Boolean)));
}

function isActiveOption(value: string) {
    return value && value !== ALL_PROMPTS_OPTION && value !== "all";
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
