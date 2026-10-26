import { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { Plus, Link2, Paperclip, BookOpen, Check, X, Search, Upload, FolderUp, ChevronLeft } from "lucide-react";
import { fetchChatSkills, saveChatSkill, removeChatSkill, readSkillImport, type ChatSkill, type SkillInput } from "@/lib/canvas/chat-skills";
import "./chat-skills-control.css";
const blank = (): SkillInput => ({ name: "", description: "", instructions: "", files: [], enabled: true });
type Props = { selectedIds: string[]; disabled: boolean; selectedNodeCount: number; onSelect: (ids: string[]) => void; onUpload: () => void; onReference: () => void };
export function ChatSkillsControl(props: Props) {
    const [skills, setSkills] = useState<ChatSkill[]>([]),
        [loading, setLoading] = useState(false),
        [error, setError] = useState("");
    const [menu, setMenu] = useState<"add" | "skills" | null>(null),
        [query, setQuery] = useState("");
    const [manager, setManager] = useState(false),
        [draft, setDraft] = useState<SkillInput | null>(null),
        [editing, setEditing] = useState<ChatSkill | undefined>();
    const [busy, setBusy] = useState(false),
        [deleting, setDeleting] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null),
        fileInput = useRef<HTMLInputElement>(null),
        folderInput = useRef<HTMLInputElement>(null),
        mutation = useRef(false),
        alive = useRef(true);
    const refresh = async () => {
        setLoading(true);
        try {
            const values = await fetchChatSkills();
            if (alive.current) {
                setSkills(values);
                setError("");
            }
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : "读取技能失败");
        } finally {
            if (alive.current) setLoading(false);
        }
    };
    useEffect(() => {
        alive.current = true;
        void refresh();
        return () => {
            alive.current = false;
        };
    }, []);
    useEffect(() => {
        if (!menu) return;
        const outside = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) setMenu(null);
        };
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                setMenu(null);
            }
        };
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", key, true);
        return () => {
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", key, true);
        };
    }, [menu]);
    useEffect(() => {
        if (props.disabled) setMenu(null);
    }, [props.disabled]);
    const mutate = async (fn: () => Promise<void>) => {
        if (mutation.current) return;
        mutation.current = true;
        setBusy(true);
        setError("");
        try {
            await fn();
            await refresh();
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : "操作失败");
        } finally {
            mutation.current = false;
            if (alive.current) setBusy(false);
        }
    };
    const create = () => {
        setEditing(undefined);
        setDraft(blank());
        setError("");
        setMenu(null);
        setManager(true);
    };
    const importFiles = async (files: File[]) => {
        if (!files.length) return;
        await mutate(async () => {
            const data = await readSkillImport(files);
            if (!alive.current) return;
            setEditing(undefined);
            setDraft(data);
            setManager(true);
            setMenu(null);
        });
    };
    const select = (skill: ChatSkill) => {
        if (props.disabled) return;
        if (props.selectedIds.includes(skill.id)) props.onSelect(props.selectedIds.filter((id) => id !== skill.id));
        else {
            if (!skill.enabled) return;
            if (props.selectedIds.length >= 3) {
                setError("每个会话最多启用 3 个技能。");
                return;
            }
            props.onSelect([...props.selectedIds, skill.id]);
        }
    };
    const filtered = skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()));
    const importButtons = (
        <>
            <button disabled={busy} onClick={() => fileInput.current?.click()}>
                <Upload size={14} />
                导入 Markdown
            </button>
            <button disabled={busy} onClick={() => folderInput.current?.click()}>
                <FolderUp size={14} />
                导入技能文件夹
            </button>
            <button disabled={busy} onClick={create}>
                <Plus size={14} />
                创建技能
            </button>
        </>
    );
    const search = (
        <label className="chat-skills-search">
            <Search size={14} />
            <input aria-label="搜索技能" placeholder="搜索名称或描述" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
    );
    return (
        <div ref={root} className="chat-skills-ui chat-skills-control">
            <input
                ref={fileInput}
                hidden
                type="file"
                accept=".md,.markdown"
                onChange={(e) => {
                    void importFiles(Array.from(e.target.files || []));
                    e.target.value = "";
                }}
            />
            <input
                ref={folderInput}
                hidden
                type="file"
                {...({ webkitdirectory: "" } as Record<string, string>)}
                multiple
                onChange={(e) => {
                    void importFiles(Array.from(e.target.files || []));
                    e.target.value = "";
                }}
            />
            <div className="canvas-chat-reference-bar">
                <button
                    disabled={props.disabled || busy}
                    aria-label="添加素材或技能"
                    aria-expanded={!!menu}
                    onClick={() => {
                        setMenu(menu ? null : "add");
                        setError("");
                    }}
                >
                    <Plus size={16} />
                </button>
                <button aria-label="选择技能" disabled={props.disabled || busy} onClick={() => { setMenu(menu === "skills" ? null : "skills"); setQuery(""); void refresh(); }}><BookOpen size={16}/>技能</button>
                <button aria-label="引用选中节点" title="引用选中节点" disabled={props.disabled || !props.selectedNodeCount} onClick={props.onReference}>
                    <Link2 size={14} />
                    引用{props.selectedNodeCount ? ` (${props.selectedNodeCount})` : ""}
                </button>

            </div>
            {menu && (
                <div className="chat-skills-popover" role="dialog" aria-label="添加素材与技能">
                    {menu === "add" ? (
                        <div className="chat-skills-add-list">
                            <button
                                disabled={!props.selectedNodeCount}
                                onClick={() => {
                                    props.onReference();
                                    setMenu(null);
                                }}
                            >
                                <Link2 size={16} />
                                从画布引用
                            </button>
                            <button
                                onClick={() => {
                                    props.onUpload();
                                    setMenu(null);
                                }}
                            >
                                <Paperclip size={16} />
                                上传素材
                            </button>
                            <button
                                onClick={() => {
                                    setMenu("skills");
                                    setQuery("");
                                    void refresh();
                                }}
                            >
                                <BookOpen size={16} />
                                技能
                            </button>
                        </div>
                    ) : (
                        <>
                            <header>
                                <button aria-label="返回添加菜单" onClick={() => setMenu("add")}>
                                    <ChevronLeft size={16} />
                                </button>
                                <strong>技能</strong>
                                <small>当前会话 · 最多 3 个</small>
                            </header>
                            {search}
                            <div className="chat-skills-list">
                                {loading ? (
                                    <p>正在读取技能…</p>
                                ) : filtered.length ? (
                                    filtered.map((skill) => (
                                        <button key={skill.id} disabled={!skill.enabled && !props.selectedIds.includes(skill.id)} aria-pressed={props.selectedIds.includes(skill.id)} onClick={() => select(skill)}>
                                            <span>
                                                <strong>{skill.name}</strong>
                                                <small>{skill.description}</small>
                                            </span>
                                            {props.selectedIds.includes(skill.id) && <Check size={16} />}
                                        </button>
                                    ))
                                ) : (
                                    <p>暂无匹配技能，可创建或导入。</p>
                                )}
                            </div>
                            <div className="chat-skills-tools">
                                {importButtons}
                                <button
                                    onClick={() => {
                                        setManager(true);
                                        setDraft(null);
                                        setMenu(null);
                                        setQuery("");
                                    }}
                                >
                                    <BookOpen size={14} />
                                    管理技能
                                </button>
                            </div>
                        </>
                    )}
                    {error && (
                        <p role="alert" className="chat-skills-error">
                            {error}
                        </p>
                    )}
                </div>
            )}
            {!!props.selectedIds.length && (
                <div className="chat-skill-chips">
                    {props.selectedIds.map((id) => {
                        const skill = skills.find((s) => s.id === id);
                        return (
                            <span key={id} title={skill?.description}>
                                <BookOpen size={12} />
                                {skill?.name || "技能不可用"}
                                {skill && !skill.enabled ? " · 已停用" : ""}
                                <button disabled={props.disabled} aria-label={`移除技能 ${skill?.name || id}`} onClick={() => props.onSelect(props.selectedIds.filter((value) => value !== id))}>
                                    <X size={12} />
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}
            {error && !menu && !manager && (
                <p className="chat-skills-error" role="alert">
                    {error}
                    <button onClick={() => void refresh()}>重试</button>
                </p>
            )}
            <Modal
                open={manager}
                title={draft ? (editing ? "编辑技能" : "创建 / 导入技能") : "管理技能"}
                footer={null}
                width={760}
                destroyOnHidden
                maskClosable={!busy}
                closable={!busy}
                keyboard={!busy}
                onCancel={() => {
                    if (!busy) {
                        setManager(false);
                        setDraft(null);
                        setError("");
                    }
                }}
            >
                <div className="chat-skills-ui chat-skills-manager">
                    {error && (
                        <p role="alert" className="chat-skills-error">
                            {error}
                        </p>
                    )}
                    {draft ? (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void mutate(async () => {
                                    await saveChatSkill(draft, editing);
                                    if (alive.current) {
                                        setDraft(null);
                                        setEditing(undefined);
                                    }
                                });
                            }}
                        >
                            <p className="chat-skills-muted">个人技能 · 仅保存到本机。启用后随当前会话发送给已配置的模型。</p>
                            <label>
                                技能名称
                                <input required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-label="技能名称" placeholder="例如 product-banner" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                                <small>小写字母、数字和连字符</small>
                            </label>
                            <label>
                                描述
                                <textarea required maxLength={1000} rows={2} aria-label="技能描述" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                            </label>
                            <label>
                                指令
                                <textarea required maxLength={40000} rows={10} aria-label="技能指令" value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
                            </label>
                            {!!draft.files.length && (
                                <details>
                                    <summary>附带资料 · {draft.files.length} 个文件（随技能发送）</summary>
                                    {draft.files.map((file) => (
                                        <details key={file.path}>
                                            <summary>{file.path}</summary>
                                            <pre>{file.content}</pre>
                                        </details>
                                    ))}
                                </details>
                            )}
                            <label className="chat-skills-enabled">
                                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                                启用技能
                            </label>
                            <div className="chat-skills-tools">
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                        setDraft(null);
                                        setEditing(undefined);
                                        setError("");
                                    }}
                                >
                                    取消
                                </button>
                                <button className="chat-skill-primary" type="submit" disabled={busy || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()}>
                                    {busy ? "保存中…" : "保存技能"}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <>
                            <div className="chat-skills-tools">
                                {importButtons}
                                <button disabled={loading || busy} onClick={() => void refresh()}>
                                    刷新
                                </button>
                            </div>
                            {search}
                            <div className="chat-skills-manage-list">
                                {filtered.map((skill) => (
                                    <article key={skill.id}>
                                        <header>
                                            <strong>{skill.name}</strong>
                                            <small>
                                                个人 · v{skill.version}
                                                {skill.enabled ? "" : " · 已停用"}
                                            </small>
                                        </header>
                                        <p>{skill.description}</p>
                                        <small>{skill.files.length} 个附带资料</small>
                                        <div className="chat-skills-tools">
                                            <button
                                                disabled={busy}
                                                onClick={() => {
                                                    setEditing(skill);
                                                    setDraft({ ...skill });
                                                    setError("");
                                                }}
                                            >
                                                编辑 {skill.name}
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={() =>
                                                    void mutate(async () => {
                                                        await saveChatSkill({ ...skill, enabled: !skill.enabled }, skill);
                                                    })
                                                }
                                            >
                                                {skill.enabled ? "停用" : "启用"} {skill.name}
                                            </button>
                                            <button disabled={busy} onClick={() => setDeleting(deleting === skill.id ? null : skill.id)}>
                                                删除 {skill.name}
                                            </button>
                                        </div>
                                        {deleting === skill.id && (
                                            <div className="chat-skills-delete">
                                                <p>删除后其他会话需移除此技能才能继续发送；已发送记录保留。</p>
                                                <button disabled={busy} onClick={() => setDeleting(null)}>
                                                    取消删除
                                                </button>
                                                <button
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void mutate(async () => {
                                                            await removeChatSkill(skill);
                                                            props.onSelect(props.selectedIds.filter((id) => id !== skill.id));
                                                            setDeleting(null);
                                                        })
                                                    }
                                                >
                                                    确认删除 {skill.name}
                                                </button>
                                            </div>
                                        )}
                                    </article>
                                ))}
                                {!filtered.length && <p className="chat-skills-muted">暂无技能。创建个人技能，或导入 SKILL.md。</p>}
                            </div>
                        </>
                    )}
                </div>
            </Modal>
        </div>
    );
}
