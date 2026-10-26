import { ArrowUpRight, RefreshCw, ImagePlus } from "lucide-react";
import type { ChatPlan } from "@/lib/canvas/canvas-chat";

export function ChatPlanCards({ plans, busy, modelReady, onRun }: { plans: ChatPlan[]; busy: boolean; modelReady: boolean; onRun: (plan: ChatPlan) => void }) {
    return (
        <div className="chat-plans">
            {plans.map((plan, index) => (
                <section className="chat-plan-card" key={plan.id} data-plan-status={plan.status}>
                    <div className="chat-plan-heading">
                        <span>方案 {index + 1}</span>
                        <span>{plan.ratio}</span>
                    </div>
                    <h4>{plan.title}</h4>
                    <p>{plan.description}</p>
                    {!!plan.copy.length && (
                        <div className="chat-plan-copy">
                            {plan.copy.map((text, i) => (
                                <div key={i}>{text}</div>
                            ))}
                        </div>
                    )}
                    <details>
                        <summary>查看完整生图提示词</summary>
                        <pre>{plan.prompt}</pre>
                    </details>
                    <div className="chat-plan-flow">
                        素材 <ArrowUpRight size={12} /> 方案 <ArrowUpRight size={12} /> 生成配置 <ArrowUpRight size={12} /> 图片
                    </div>
                    {plan.error && (
                        <p role="alert" className="canvas-chat-error-text">
                            {plan.error}
                        </p>
                    )}
                    {plan.status === "completed" ? (
                        <p className="chat-plan-done">✓ 图片已生成，工作流已保存到画布</p>
                    ) : plan.status === "running" ? (
                        <p role="status">正在生成，工作流已创建…</p>
                    ) : (
                        <button className="canvas-chat-primary" disabled={busy || !modelReady} onClick={() => onRun(plan)}>
                            {plan.workflow ? <RefreshCw size={14} /> : <ImagePlus size={14} />} {plan.workflow ? "重试此方案" : "采用并生成"}
                        </button>
                    )}
                    {!modelReady && plan.status !== "completed" && <small>请先在上方选择图片模型</small>}
                </section>
            ))}
        </div>
    );
}
