import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { ModelIcon } from "@/components/model-picker";
import { modelOptionLabel, decodeChannelModel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

type Props = {
    config: AiConfig;
    textModel: string;
    imageModel: string;
    followsText: boolean;
    followsImage: boolean;
    disabled: boolean;
    onSelect: (kind: "text" | "image", value?: string) => void;
    onConfigure: () => void;
};

export function ChatModelMenu(props: Props) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<"text" | "image">("text");
    const [expanded, setExpanded] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                trigger.current?.focus();
            }
        };
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape, true);
        return () => {
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", escape, true);
        };
    }, [open]);
    useEffect(() => {
        if (props.disabled) setOpen(false);
    }, [props.disabled]);
    const selected = kind === "text" ? props.textModel : props.imageModel;
    const follows = kind === "text" ? props.followsText : props.followsImage;
    const models = selectableModelsByCapability(props.config, kind);
    const defaultModel = props.config[`${kind}Model`];
    const choose = (value?: string) => {
        props.onSelect(kind, value);
        setOpen(false);
        trigger.current?.focus();
    };
    return (
        <div className="chat-model-menu-anchor" ref={root}>
            <button ref={trigger} className="chat-model-menu-trigger" aria-label="模型设置" title="选择文案与图片模型" aria-expanded={open} aria-haspopup="dialog" disabled={props.disabled} onClick={() => setOpen((value) => !value)}>
                <Sparkles size={19} />
                模型
            </button>
            {open && (
                <div className="chat-model-popover" role="dialog" aria-label="文案与图片模型">
                    <div className="chat-model-tabs" role="tablist" aria-label="模型类型">
                        {(["text", "image"] as const).map((value) => (
                            <button
                                key={value}
                                role="tab"
                                aria-selected={kind === value}
                                onClick={() => {
                                    setKind(value);
                                    setExpanded(false);
                                }}
                            >
                                {value === "text" ? "文案模型" : "图片模型"}
                            </button>
                        ))}
                    </div>
                    <div className="chat-model-options" role="group" aria-label={kind === "text" ? "文案模型列表" : "图片模型列表"}>
                        <button className={`chat-model-default${follows ? " is-selected" : ""}`} aria-pressed={follows} onClick={() => choose()}>
                            <span>
                                <strong>跟随默认</strong>
                                <small>{defaultModel ? modelOptionLabel(props.config, defaultModel) : "尚未保存默认模型"}</small>
                            </span>
                            {follows && <Check size={17} />}
                        </button>
                        <p className="chat-model-section-label">可用模型</p>
                        {props.config.channels.map((channel) => {
                            const values = (expanded ? models : models.slice(0, 5)).filter((value) => decodeChannelModel(value)?.channelId === channel.id);
                            return values.length ? (
                                <div key={channel.id} role="group" aria-label={channel.name}>
                                    <p className="chat-model-section-label">{channel.name}</p>
                                    {values.map((value) => (
                                        <button className="chat-model-option" key={value} aria-pressed={!follows && selected === value} title={modelOptionLabel(props.config, value)} onClick={() => choose(value)}>
                                            <ModelIcon model={value} />
                                            <span>{modelOptionLabel(props.config, value)}</span>
                                            {!follows && selected === value && <Check size={16} />}
                                        </button>
                                    ))}
                                </div>
                            ) : null;
                        })}
                        {!models.length && (
                            <div className="chat-model-empty">
                                <p>暂无可用模型</p>
                                <button
                                    onClick={() => {
                                        setOpen(false);
                                        props.onConfigure();
                                    }}
                                >
                                    配置 API
                                </button>
                            </div>
                        )}
                    </div>
                    {models.length > 5 && (
                        <button className="chat-model-more" onClick={() => setExpanded((value) => !value)}>
                            {expanded ? "收起模型" : `更多模型 · ${models.length}`}
                            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
