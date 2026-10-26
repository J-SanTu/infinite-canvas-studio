import { CanvasNodeType, type CanvasNodeData, type CanvasConnection, type Position } from "@/types/canvas";
import { captureReferences, referenceVersion, type ChatPlan } from "./canvas-chat";

export function validatePlanReferences(plan: ChatPlan, projectId: string, nodes: CanvasNodeData[]) {
    if (plan.projectId !== projectId) throw new Error("画布已切换，请回到原画布操作。");
    const refs = captureReferences(nodes, plan.referenceIds);
    for (const ref of refs) if (referenceVersion(ref) !== plan.referenceVersions[ref.id]) throw new Error(`素材「${ref.title}」已变化，请重新生成方案。`);
    return refs;
}
export function buildChatWorkflow(plan: ChatPlan, model: string, existing: CanvasNodeData[], origin: Position) {
    const ids = { textId: `plan-text-${plan.id}`, configId: `plan-config-${plan.id}`, resultId: `plan-result-${plan.id}` };
    if (Object.values(ids).some((id) => existing.some((node) => node.id === id))) throw new Error("该方案的工作流已经存在，请使用重试。");
    const x = existing.length ? Math.max(...existing.map((node) => node.position.x + node.width)) + 100 : origin.x;
    const y = origin.y;
    const prompt = `${plan.prompt}\n\n画布比例：${plan.ratio}。保留参考素材中产品的外形与细节；Logo 使用提供的原始样式、比例和配色。${plan.copy.length ? `上画文案逐字使用：\n${plan.copy.join("\n")}` : "不添加未经提供的规格、价格或优惠文案。"}`;
    const nodes: CanvasNodeData[] = [
        { id: ids.textId, type: CanvasNodeType.Text, title: plan.title, position: { x, y }, width: 340, height: 320, metadata: { content: prompt, chatPlanId: plan.id } },
        {
            id: ids.configId,
            type: CanvasNodeType.Config,
            title: `${plan.title} · 生成`,
            position: { x: x + 440, y },
            width: 340,
            height: 280,
            metadata: { prompt: "", model, size: plan.ratio, count: 1, generationMode: "image", status: "loading", chatPlanId: plan.id },
        },
        { id: ids.resultId, type: CanvasNodeType.Image, title: `${plan.title} · 结果`, position: { x: x + 880, y }, width: 360, height: 288, metadata: { prompt, model, size: plan.ratio, status: "loading", chatPlanId: plan.id } },
    ];
    const pairs = [...plan.referenceIds.map((id) => [id, ids.configId]), [ids.textId, ids.configId], [ids.configId, ids.resultId]];
    const connections: CanvasConnection[] = pairs.map(([fromNodeId, toNodeId]) => ({ id: `${plan.id}-${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId }));
    return { nodes, connections, ids, prompt };
}
