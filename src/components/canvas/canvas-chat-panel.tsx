import { ChatSkillsControl } from "./chat-skills-control";
import { fetchChatSkills, snapshotSkills } from "@/lib/canvas/chat-skills";
import type { CanvasChatDropTarget } from "@/lib/canvas/chat-drop";
import { useEffect, useRef, useState, type ClipboardEvent, type Dispatch, type SetStateAction, type RefObject } from "react";
import { MessageSquare, Plus, Send, Square, X, Link2, ChevronDown, Check, Copy, Paperclip, Maximize2, SquarePen } from "lucide-react";
import { nanoid } from "nanoid";
import { ChatModelMenu } from "./chat-model-menu";
import { useConfigStore, useEffectiveConfig, resolveConfiguredModel, selectableModelsByCapability } from "@/stores/use-config-store";
import { requestImageQuestion } from "@/services/api/image";
import { buildChatMessages, captureReferences, parseChatReply, splitSvgText, requestedChatRatio, type ChatPlan, type ChatProposal } from "@/lib/canvas/canvas-chat";
import type { CanvasAssistantSession, CanvasAssistantMessage, CanvasNodeData } from "@/types/canvas";
import "./canvas-chat-panel.css";
import { prepareChatAsset, chatVisionImages, type ChatAsset } from "@/lib/canvas/chat-attachments";
import { ChatPlanCards } from "./chat-plan-cards";

type Props = {
    dropTargetRef: RefObject<CanvasChatDropTarget | null>;
    navigationToggle?: number;
    onOpenChange?: (open: boolean) => void;
    projectId: string;
    nodes: CanvasNodeData[];
    selectedIds: Set<string>;
    sessions: CanvasAssistantSession[];
    activeId: string | null;
    setSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
    setActiveId: (id: string) => void;
    applyProposal: (proposal: ChatProposal) => void;
    addAssets: (assets: ChatAsset[]) => void;
    generatePlan: (plan: ChatPlan, model: string, signal: AbortSignal, onStarted: (workflow: NonNullable<ChatPlan["workflow"]>) => void) => Promise<void>;
};

export function CanvasChatPanel(props: Props) {
    const panelRef = useRef<HTMLElement>(null);
    const historyPickerRef = useRef<HTMLDivElement>(null);
    const [dragIds, setDragIds] = useState<string[] | null>(null);
    const [open, setOpen] = useState(props.navigationToggle === undefined);
    useEffect(() => { if (props.navigationToggle) setOpen(v=>!v); }, [props.navigationToggle]);
    useEffect(() => { props.onOpenChange?.(open); }, [open, props.onOpenChange]);
    const [expanded, setExpanded] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [nameDraft, setNameDraft] = useState("");
    const [prompt, setPrompt] = useState("");
    const [referenceIds, setReferenceIds] = useState<string[]>(
        () =>
            props.sessions
                .find((s) => s.id === props.activeId)
                ?.messages.filter((m) => m.role === "user")
                .at(-1)
                ?.references?.map((r) => r.id) || [],
    );
    const [busy, setBusy] = useState(false);
    const [importing, setImporting] = useState(false);
    const importingRef = useRef(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const promptInput = useRef<HTMLTextAreaElement>(null);
    const runningPlan = useRef<{ sessionId: string; messageId: string; planId: string } | null>(null);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState("");
    const latest = useRef(props);
    latest.current = props;
    const request = useRef<AbortController | null>(null);
    const mounted = useRef(true);
    const handled = useRef(new Set<string>());
    const list = useRef<HTMLDivElement>(null);
    const config = useEffectiveConfig();
    const session = props.sessions.find((item) => item.id === props.activeId);
    const model = resolveConfiguredModel(config, "text", session?.model, session?.modelRevision);
    const modelReady = !!model && selectableModelsByCapability(config, "text").includes(model);
    const imageModel = resolveConfiguredModel(config, "image", session?.imageModel, session?.imageModelRevision);
    const imageModelReady = !!imageModel && selectableModelsByCapability(config, "image").includes(imageModel);
    const locked = busy || importing;
    const settings = () => useConfigStore.getState().openConfigDialog(false, "apis");

    useEffect(() => {
        if (!historyOpen) return;
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !historyPickerRef.current?.contains(event.target)) setHistoryOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setHistoryOpen(false);
        };
        // Capture also catches canvas and composer events that stop propagation.
        document.addEventListener("pointerdown", closeOutside, true);
        document.addEventListener("keydown", closeOnEscape, true);
        return () => {
            document.removeEventListener("pointerdown", closeOutside, true);
            document.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [historyOpen]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            request.current?.abort();
            request.current = null;
        };
    }, []);
    useEffect(() => {
        const container = list.current;
        if (!container) return;
        const last = container.querySelector("article:last-of-type");
        if (!busy && session?.messages.at(-1)?.plans?.length && last) container.scrollTop += last.getBoundingClientRect().top - container.getBoundingClientRect().top;
        else container.scrollTo({ top: container.scrollHeight });
    }, [session?.messages.length, busy, progress]);

    useEffect(() => {
        const target: CanvasChatDropTarget = {
            contains: (x, y) => {
                const element = panelRef.current;
                if (!open || !element) return false;
                const rect = element.getBoundingClientRect();
                return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && element.contains(document.elementFromPoint(x, y));
            },
            hover: (ids) => setDragIds(current => JSON.stringify(current) === JSON.stringify(ids) ? current : ids),
            drop: (ids) => {
                setDragIds(null);
                if (locked || request.current || importingRef.current) { setError("当前正在处理，请完成后再拖入引用。"); return; }
                const valid = ids.filter(id => props.nodes.some(node => node.id === id));
                const next = [...new Set([...referenceIds, ...valid])];
                if (next.length > 12) { setError("一次最多引用 12 个节点，请减少选择后重试。"); return; }
                setReferenceIds(next); setError(""); promptInput.current?.focus();
            },
        };
        props.dropTargetRef.current = target;
        return () => { if (props.dropTargetRef.current === target) props.dropTargetRef.current = null; };
    }, [open, locked, props.nodes, referenceIds, props.dropTargetRef]);

    const updateSession = (id: string, update: (value: CanvasAssistantSession) => CanvasAssistantSession) => {
        props.setSessions((sessions) => sessions.map((value) => (value.id === id ? { ...update(value), updatedAt: new Date().toISOString() } : value)));
    };
    const beginRename = (id: string) => {
        const target = props.sessions.find(item => item.id === id);
        if (!target || locked) return;
        props.setActiveId(id); setHistoryOpen(false); setNameDraft(target.title); setRenaming(id);
    };
    const commitName = () => {
        if (!renaming) return;
        const title = nameDraft.trim();
        if (title) updateSession(renaming, value => ({...value, title, titleEdited: true}));
        setRenaming(null);
    };
    const append = (id: string, message: CanvasAssistantMessage) => updateSession(id, (value) => ({ ...value, messages: [...value.messages, message] }));
    const createSession = () => {
        const next: CanvasAssistantSession = { id: nanoid(), title: "新对话", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        props.setSessions((sessions) => [...sessions, next]);
        props.setActiveId(next.id);
        return next;
    };
    const changeSession = (id?: string) => {
        if (request.current || importingRef.current) return;
        setHistoryOpen(false);
        setRenaming(null);
        if (id && id === session?.id) return;
        if (id) props.setActiveId(id);
        else createSession();
        setReferenceIds(
            id
                ? props.sessions
                      .find((s) => s.id === id)
                      ?.messages.filter((m) => m.role === "user")
                      .at(-1)
                      ?.references?.map((r) => r.id) || []
                : [],
        );
        setPrompt("");
        setError("");
    };
    const attachFiles = async (files: File[]) => {
        if (request.current || importingRef.current || !files.length) return [];
        if (files.length + referenceIds.length > 12) {
            setError("一次最多引用 12 个素材，请减少后重试。");
            return [];
        }
        importingRef.current = true;
        setImporting(true);
        setError("");
        try {
            const assets = await Promise.all(files.map(prepareChatAsset));
            if (!mounted.current) return [];
            props.addAssets(assets);
            const ids = assets.map((asset) => asset.id);
            setReferenceIds((current) => [...new Set([...current, ...ids])]);
            return ids;
        } catch (cause) {
            if (mounted.current) setError(cause instanceof Error ? cause.message : "素材导入失败。");
            return [];
        } finally {
            importingRef.current = false;
            if (mounted.current) setImporting(false);
        }
    };
    const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const text = event.clipboardData.getData("image/svg+xml") || event.clipboardData.getData("text/plain");
        const split = splitSvgText(text);
        const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (!split.svgs.length && !files.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (split.svgs.length) {
            const start = event.currentTarget.selectionStart,
                end = event.currentTarget.selectionEnd;
            setPrompt((value) => value.slice(0, start) + split.text + value.slice(end));
            void attachFiles(split.svgs.map((svg, index) => new File([svg], `Logo${index ? `-${index + 1}` : ""}.svg`, { type: "image/svg+xml" })));
        } else void attachFiles(files);
    };
    const send = async () => {
        if (request.current || importingRef.current || (!prompt.trim() && !referenceIds.length) || !modelReady) return;
        const pastedSvg = splitSvgText(prompt);
        if (pastedSvg.svgs.length) {
            setPrompt(pastedSvg.text);
            await attachFiles(pastedSvg.svgs.map((svg, index) => new File([svg], `Logo-${index + 1}.svg`, { type: "image/svg+xml" })));
            return; // Let the user review the new attachment chips before sending.
        }
        setError("");
        const controller = new AbortController();
        let target = session;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        request.current = controller;
        setBusy(true);
        setProgress(0);
        try {
            const skillIds = target?.skillIds || [];
            const skills = skillIds.length ? snapshotSkills(await fetchChatSkills(), skillIds) : [];
            if (!mounted.current || controller.signal.aborted || request.current !== controller) return;
            const references = captureReferences(latest.current.nodes, referenceIds);
            const images = await chatVisionImages(references);
            if (!mounted.current || controller.signal.aborted || request.current !== controller) return;
            const text = prompt.trim() || "请分析这些素材，给出可选择的设计方向。";
            const messages = buildChatMessages(target?.messages || [], text, references, images, skills);
            const ratio = requestedChatRatio(target?.messages || [], text);
            target = target || createSession();
            const id = target.id;
            updateSession(id, (value) => ({ ...value, title: value.messages.length || value.titleEdited ? value.title : text.slice(0, 36), messages: [...value.messages, { id: nanoid(), role: "user", text, references, skills }] }));
            setPrompt("");
            timeout = setTimeout(() => controller.abort(new Error("回复超时，请重试。")), 120_000);
            const raw = await requestImageQuestion(
                { ...config, model, systemPrompt: "" },
                messages,
                (value) => {
                    if (mounted.current && request.current === controller && !controller.signal.aborted) setProgress(value.length);
                },
                { signal: controller.signal },
            );
            if (!mounted.current || request.current !== controller || controller.signal.aborted) return;
            const result = parseChatReply(raw, props.projectId, references, nanoid(), ratio);
            append(id, { id: nanoid(), role: "assistant", ...result });
        } catch (cause) {
            if (!mounted.current || request.current !== controller) return;
            const text = controller.signal.aborted ? "回复超时或已停止，请重试。" : cause instanceof Error ? cause.message : "对话失败。";
            setError(text);
            if (target) append(target.id, { id: nanoid(), role: "error", text });
        } finally {
            clearTimeout(timeout);
            if (mounted.current && request.current === controller) {
                request.current = null;
                setBusy(false);
            }
        }
    };
    const patchPlan = (sessionId: string, messageId: string, planId: string, patch: Partial<ChatPlan>) =>
        updateSession(sessionId, (value) => ({ ...value, messages: value.messages.map((item) => (item.id === messageId ? { ...item, plans: item.plans?.map((plan) => (plan.id === planId ? { ...plan, ...patch } : plan)) } : item)) }));
    const runPlan = async (messageId: string, plan: ChatPlan) => {
        if (!session || request.current || importingRef.current || !imageModelReady || plan.status === "completed") return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setError("");
        runningPlan.current = { sessionId: session.id, messageId, planId: plan.id };
        patchPlan(session.id, messageId, plan.id, { status: "running", error: undefined, model: imageModel });
        const timer = setTimeout(() => controller.abort(), 300_000);
        try {
            await props.generatePlan(plan, imageModel, controller.signal, (workflow) => {
                if (mounted.current) patchPlan(session.id, messageId, plan.id, { workflow });
            });
            if (mounted.current && request.current === controller) patchPlan(session.id, messageId, plan.id, { status: "completed", error: undefined });
        } catch (cause) {
            if (mounted.current && request.current === controller)
                patchPlan(session.id, messageId, plan.id, { status: controller.signal.aborted ? "cancelled" : "failed", error: controller.signal.aborted ? "生成已停止，可在原工作流重试。" : cause instanceof Error ? cause.message : "生成失败，可重试。" });
        } finally {
            clearTimeout(timer);
            if (mounted.current && request.current === controller) {
                request.current = null;
                runningPlan.current = null;
                setBusy(false);
            }
        }
    };
    const stop = () => {
        const controller = request.current;
        if (!controller) return;
        request.current = null;
        controller.abort();
        setBusy(false);
        const run = runningPlan.current;
        if (run) {
            patchPlan(run.sessionId, run.messageId, run.planId, { status: "cancelled", error: "已停止生成，工作流保留，可重试。" });
            runningPlan.current = null;
        } else if (session) append(session.id, { id: nanoid(), role: "system", text: "已停止回复。" });
    };
    const decide = (messageId: string, proposal: ChatProposal, apply: boolean) => {
        if (!session || handled.current.has(proposal.id) || proposal.status !== "pending") return;
        handled.current.add(proposal.id);
        let status: ChatProposal["status"] = "cancelled";
        let result = "已取消，画布未修改。";
        try {
            if (apply) {
                props.applyProposal(proposal);
                status = "applied";
                result = proposal.kind === "create_text" ? "文本节点已创建，可使用画布撤销。" : "文本节点已修改，可使用画布撤销。";
            }
        } catch (cause) {
            status = "failed";
            result = cause instanceof Error ? cause.message : "操作失败，画布未修改。";
        }
        updateSession(session.id, (value) => ({ ...value, messages: value.messages.map((item) => (item.id === messageId ? { ...item, proposals: item.proposals?.map((p) => (p.id === proposal.id ? { ...p, status, result } : p)) } : item)) }));
    };
    const offerText = (message: CanvasAssistantMessage) => {
        if (!session) return;
        const proposal: ChatProposal = { id: nanoid(), projectId: props.projectId, kind: "create_text", title: "对话摘录", content: message.text, status: "pending" };
        updateSession(session.id, (value) => ({ ...value, messages: value.messages.map((item) => (item.id === message.id ? { ...item, proposals: [...(item.proposals || []), proposal] } : item)) }));
    };

    return (
        <>
            {!open && props.navigationToggle === undefined && (
                <button className="canvas-chat-launch" onClick={() => setOpen(true)} aria-label="打开画布对话">
                    <MessageSquare size={18} />
                    画布对话{busy ? " · 回复中" : ""}
                </button>
            )}
            <aside
                ref={panelRef}
                onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void attachFiles(Array.from(event.dataTransfer.files));
                }}
                className={`canvas-chat-panel${expanded ? " canvas-chat-expanded" : ""}${dragIds ? " canvas-chat-drag-over" : ""}`}
                hidden={!open}
                data-canvas-no-zoom
                aria-label="画布对话"
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
                {dragIds && <div className="chat-node-drop-hint" role="status">{locked ? "当前正在处理，请稍后拖入" : `松开鼠标，引用 ${dragIds.length} 个画布元素`}</div>}
                <div className="canvas-chat-controls">
                    <div className="canvas-chat-history">
                        <div className="chat-history-picker" ref={historyPickerRef}>
                            {renaming === session?.id && renaming ? <input autoFocus aria-label="对话名称" value={nameDraft} maxLength={80} onChange={e => setNameDraft(e.target.value)} onBlur={commitName} onKeyDown={e => {
                                if (e.nativeEvent.isComposing) return;
                                if (e.key === "Enter") { e.preventDefault(); commitName(); }
                                if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
                            }} /> : <button className="chat-history-current" title="双击重命名" aria-label="当前对话名称" disabled={locked} onDoubleClick={() => session && beginRename(session.id)} onClick={() => setHistoryOpen(value => !value)}>{session?.title || "新对话"}</button>}
                            <button aria-label="对话历史" aria-expanded={historyOpen} disabled={locked} onClick={() => setHistoryOpen(value => !value)}><ChevronDown size={16}/></button>
                            {historyOpen && <div className="chat-history-menu" role="listbox" aria-label="选择对话">{props.sessions.map(item => <button key={item.id} role="option" aria-selected={item.id === session?.id} onClick={() => { changeSession(item.id); setHistoryOpen(true); }} onDoubleClick={() => beginRename(item.id)}>{item.title}</button>)}<button onClick={() => setHistoryOpen(false)}>收起列表</button></div>}
                        </div>
                        <button onClick={() => changeSession()} disabled={locked} aria-label="新建对话">
                            <SquarePen size={18} />
                        </button>
                        <button aria-label="展开画布对话" aria-pressed={expanded} onClick={() => setExpanded(v => !v)}><Maximize2 size={18}/></button>
                        <button aria-label="收起画布对话" onClick={() => setOpen(false)}><X size={18}/></button>
                    </div>
                </div>
                <div className="canvas-chat-messages" ref={list} aria-live="polite">
                    {!session?.messages.length && (
                        <div className="canvas-chat-empty">
                            <p className="chat-greeting">你好，创作者</p>
                            <h3>今天一起创作点什么？</h3>
                            <button onClick={() => setPrompt("根据素材设计 5:4 的宣传 banner，给我不同的方案。")}><strong>从一张产品宣传图开始 ↗</strong><span>放入素材，选择方案，生成到画布。</span></button>
                            <button onClick={() => panelRef.current?.querySelector<HTMLButtonElement>('[aria-label="选择技能"]')?.click()}><strong>使用我的创作技能 ↗</strong><span>选择或导入技能，复用文案和设计要求。</span></button>
                        </div>
                    )}
                    {session?.messages.map((item) => (
                        <article key={item.id} className={`canvas-chat-message canvas-chat-${item.role}`} data-message-id={item.id}>
                            <div className="canvas-chat-role">{item.role === "user" ? "你" : item.role === "assistant" ? "画布助手" : "提示"}</div>
                            {!!item.references?.length && (
                                <div className="chat-attachment-list">
                                    {item.references.map((ref) => (
                                        <span className="chat-attachment" key={ref.id} title={ref.title}>
                                            {ref.type === "image" && ref.dataUrl ? <img src={ref.dataUrl} alt={ref.title} /> : null}
                                            <span>{ref.svg ? "SVG" : ref.type === "image" ? "图片" : "文本"}</span>
                                            <small>{ref.title}</small>
                                        </span>
                                    ))}
                                </div>
                            )}
                            {!!item.skills?.length && <div className="chat-used-skills">已使用技能：{item.skills.map(skill => `${skill.name} · v${skill.version}`).join("、")}</div>}
                            <div className="canvas-chat-text">{splitSvgText(item.text).text}</div>
                            {splitSvgText(item.text).svgs.map((svg, index) => (
                                <button key={index} className="chat-legacy-svg" disabled={locked} onClick={() => void attachFiles([new File([svg], "Logo.svg", { type: "image/svg+xml" })])}>
                                    <b>SVG</b>
                                    <span>矢量素材 · 导入画布</span>
                                </button>
                            ))}
                            {!!item.plans?.length && <ChatPlanCards plans={item.plans} busy={locked} modelReady={imageModelReady} onRun={(plan) => void runPlan(item.id, plan)} />}
                            {item.role === "assistant" && (
                                <div className="canvas-chat-message-actions">
                                    <button
                                        onClick={() => {
                                            void navigator.clipboard
                                                .writeText(item.text)
                                                .then(() => setCopied(item.id))
                                                .catch(() => setError("复制失败，请选择文本手动复制。"));
                                        }}
                                    >
                                        <Copy size={13} />
                                        {copied === item.id ? "已复制" : "复制"}
                                    </button>
                                    <button disabled={locked || item.proposals?.some((p) => p.status === "pending")} onClick={() => offerText(item)}>
                                        添加为文本节点
                                    </button>
                                </div>
                            )}
                            {item.proposals?.map((proposal) => (
                                <section className="canvas-chat-proposal" key={proposal.id} data-proposal-status={proposal.status}>
                                    <strong>
                                        {proposal.kind === "create_text" ? "创建文本节点" : "修改文本节点"} · {proposal.title}
                                    </strong>
                                    {proposal.kind === "update_text" && (
                                        <details>
                                            <summary>修改前的内容</summary>
                                            <pre>{proposal.before || "（空文本）"}</pre>
                                        </details>
                                    )}
                                    <div className="canvas-chat-preview-label">{proposal.kind === "create_text" ? "节点内容" : "修改后的内容"}</div>
                                    <pre>{proposal.content || "（空文本）"}</pre>
                                    {proposal.status === "pending" ? (
                                        <>
                                            <p>尚未执行，请确认后写入画布。</p>
                                            <div className="canvas-chat-proposal-actions">
                                                <button disabled={locked} onClick={() => decide(item.id, proposal, false)}>
                                                    取消
                                                </button>
                                                <button disabled={locked} className="canvas-chat-primary" onClick={() => decide(item.id, proposal, true)}>
                                                    <Check size={14} />
                                                    {proposal.kind === "create_text" ? "确认创建" : "确认修改"}
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <p role="status">{proposal.result}</p>
                                    )}
                                </section>
                            ))}
                        </article>
                    ))}
                    {busy && (
                        <div className="canvas-chat-working" role="status">
                            <span />
                            {runningPlan.current ? "正在生成图片" : "正在整理回复"}
                            {progress && !runningPlan.current ? ` · 已接收 ${progress} 字符` : "…"}
                        </div>
                    )}
                </div>
                <div className="canvas-chat-composer">
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                        multiple
                        hidden
                        onChange={(event) => {
                            void attachFiles(Array.from(event.target.files || []));
                            event.target.value = "";
                        }}
                    />
                    {!!referenceIds.length && (
                        <div className="chat-attachment-list">
                            {referenceIds.map((id) => {
                                const node = props.nodes.find((node) => node.id === id);
                                return (
                                    <span className="chat-attachment" key={id}>
                                        {node?.type === "image" && node.metadata?.content ? <img src={node.metadata.content} alt={node.title} /> : null}
                                        <span>{node?.metadata?.chatSvg ? "SVG" : node?.type === "image" ? "图片" : "文本"}</span>
                                        <small>{node?.title || "节点已删除"}</small>
                                        <button disabled={locked} aria-label={`移除引用 ${id}`} onClick={() => setReferenceIds((ids) => ids.filter((value) => value !== id))}>
                                            <X size={12} />
                                        </button>
                                    </span>
                                );
                            })}
                        </div>
                    )}
                    {importing && <p role="status">正在导入素材到画布…</p>}
                    <textarea
                        ref={promptInput}
                        onPaste={paste}
                        aria-label="对话消息"
                        placeholder="粘贴图片 / SVG，描述你想要的画面…"
                        value={prompt}
                        disabled={locked}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                void send();
                            }
                        }}
                        rows={3}
                    />
                    {error && (
                        <p className="canvas-chat-error-text" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="canvas-chat-send">
                    <ChatSkillsControl selectedIds={session?.skillIds || []} disabled={locked} selectedNodeCount={props.selectedIds.size}
                        onUpload={() => fileInput.current?.click()} onReference={() => setReferenceIds(ids => [...new Set([...ids, ...props.selectedIds])])}
                        onSelect={ids => { if (!session && !ids.length) return; const current = session || createSession(); updateSession(current.id, value => ({...value, skillIds:ids})); }} />

                        <ChatModelMenu config={config} textModel={model} imageModel={imageModel}
                            followsText={!session?.model || (!!config.defaultModelsRevision && session.modelRevision !== config.defaultModelsRevision)}
                            followsImage={!session?.imageModel || (!!config.defaultModelsRevision && session.imageModelRevision !== config.defaultModelsRevision)}
                            disabled={locked} onConfigure={settings}
                            onSelect={(kind, value) => {
                                const current = session || createSession();
                                updateSession(current.id, item => kind === "text" ? {...item, model:value, modelRevision:config.defaultModelsRevision} : {...item, imageModel:value, imageModelRevision:config.defaultModelsRevision});
                                setError("");
                            }} />
                        <small title="Enter 发送 · Shift+Enter 换行">{modelReady ? "Enter 发送" : "请选择文案模型"}</small>
                        {busy ? (
                            <button onClick={stop}>
                                <Square size={14} />
                                停止
                            </button>
                        ) : (
                            <button aria-label="发送" title="Enter 发送 · Shift+Enter 换行" className="canvas-chat-primary" disabled={importing || !modelReady || (!prompt.trim() && !referenceIds.length)} onClick={() => void send()}>
                                <Send size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </aside>
        </>
    );
}
