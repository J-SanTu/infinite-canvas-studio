import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
export function creativeSources(id: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const direct = connections.filter((e) => e.toNodeId === id).map((e) => e.fromNodeId);
    const config = connections.find((e) => e.fromNodeId === id && nodes.find((n) => n.id === e.toNodeId)?.type === CanvasNodeType.Config);
    if (config) direct.push(...connections.filter((e) => e.toNodeId === config.toNodeId).map((e) => e.fromNodeId));
    return nodes.filter((n) => direct.includes(n.id) && n.type === CanvasNodeType.Creative);
}
export function chooseCreativeRatio(planned: string, downstream: string): Promise<"plan" | "downstream" | null> {
    return new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.style.cssText = "padding:24px;border-radius:16px;max-width:480px;background:#242424;color:white";
        const title = document.createElement("h2");
        title.textContent = "尺寸比例不符合";
        const body = document.createElement("p");
        body.textContent = `提示词比例：${planned}；下游比例：${downstream}。使用下游比例可能导致图片展示不全。`;
        dialog.append(title, body);
        const done = (value: "plan" | "downstream" | null) => {
            dialog.close();
            dialog.remove();
            resolve(value);
        };
        for (const [label, value] of [
            [`使用提示词比例 ${planned}`, "plan"],
            [`使用下游比例 ${downstream}，我已知晓风险`, "downstream"],
            ["取消", null],
        ] as const) {
            const button = document.createElement("button");
            button.textContent = label;
            button.style.cssText = "display:block;margin:12px 0;padding:8px;border:1px solid #888;border-radius:6px";
            button.onclick = () => done(value);
            dialog.append(button);
        }
        dialog.oncancel = (e) => {
            e.preventDefault();
            done(null);
        };
        document.body.append(dialog);
        dialog.showModal();
    });
}

export function composeCreativePrompt(c: NonNullable<CanvasNodeData["metadata"]>["creative"]) {
    if (!c?.description.trim()) return "";
    return `${c.description}\n目标比例：${c.ratio}\n画面文案（严格使用以下文字）：\n${c.copies.map((x) => `${x.role}: ${x.text}`).join("\n")}`;
}
