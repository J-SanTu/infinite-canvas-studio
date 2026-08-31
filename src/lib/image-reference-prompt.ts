import type { ReferenceImage } from "@/types/image";

export function isDirectorReferenceImage(reference: Pick<ReferenceImage, "isDirectorReference" | "storageKey" | "url"> | null | undefined) {
    return Boolean(reference?.isDirectorReference || reference?.storageKey?.startsWith("image:director_asset_") || reference?.url?.includes("/api/director-assets/"));
}

export function isDirectorPoseChangeRequested(prompt: string) {
    const text = prompt.trim();
    if (!text) return false;
    const explicitChange = /(?:姿势|动作|pose|posture).{0,10}(?:可以|可|允许|能够|自由)?(?:改变|调整|更换|变化)|(?:可以|可|允许|能够|自由).{0,10}(?:改变|调整|更换|变化).{0,10}(?:姿势|动作)|(?:change|adjust|switch|vary)\s+(?:the\s+)?(?:pose|posture)/i.test(text);
    const explicitLock = /(?:姿势|动作|pose|posture).{0,10}(?:保持|固定|不能|不可|不要|不变)|(?:keep|maintain|preserve|do\s+not\s+change)\s+(?:the\s+)?(?:pose|posture)/i.test(text);
    return explicitChange && !explicitLock;
}

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function imageReferenceAliases(index: number) {
    const numberLabel = String(index + 1);
    const chineseLabel = chineseOrdinal(index);
    return [`图${chineseLabel}`, `图片${chineseLabel}`, `图${numberLabel}`, imageReferenceLabel(index)];
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const directorIndexes = references.flatMap((reference, index) => (isDirectorReferenceImage(reference) ? [index] : []));
    const directorLock = directorIndexes.length > 0;
    const labels = references.map((_, index) => {
        const aliases = imageReferenceAliases(index);
        return `${imageReferenceLabel(index)}（也称${aliases.filter((alias) => alias !== imageReferenceLabel(index)).join("、")}）`;
    });
    const referenceHeader = `参考图片编号：${labels.join("；")}。请严格按这些编号和别名理解提示词中的图片引用，图一/图二等顺序词对应上传参考图的顺序。`;
    if (!directorLock) return `${referenceHeader}\n\n${text}`;

    const directorLabels = directorIndexes.map((index) => imageReferenceLabel(index)).join("、");
    const contentConstraints = buildDirectorContentConstraints(text);
    const poseCanChange = isDirectorPoseChangeRequested(text);
    const poseConstraints = poseCanChange
        ? "【姿势模式：允许改变】用户明确允许改变人物姿势。导演台不锁定人物骨架、坐站姿或四肢角度，只锁定镜头、构图、人物在画面中的大致位置和人与目标元素的交互锚点。允许人物为了动作自然改变手臂和腿部姿势，但必须保持交互语义和可信接触：手里拿/捧产品时，产品仍在手掌区域且手与产品有接触；依靠物体时，身体仍与支撑面接触。手指细节不作为参考约束，生成自然完整的手掌和五指，避免多指、缺指、粘连、交叉或僵硬变形。"
        : "【姿势模式：保持参考】保持导演台参考图中的坐姿/站姿、头部朝向、躯干方向、腿部大致方向，以及与车辆或道具的支撑/接触点。手部只锁定手臂方向、手掌所在区域和是否接触物体；白模或简化模型的手指细节不作为约束，允许在该区域内自然重绘完整手掌和五指，避免多指、缺指、粘连、交叉或僵硬变形。";
    const poseCheck = poseCanChange ? "人物与目标元素的交互锚点、支撑关系和接触是否可信" : "人物粗姿势、人物与元素接触点";
    return `${referenceHeader}\n\n【导演台双锁定，结构与元素分工执行】\n导演台参考图为：${directorLabels}。它是最终的构图、镜头和交互蓝图，不是灵感图。执行优先级从高到低为：1) 画幅、相机视角、主体位置与占比、透视、地平线、遮挡和接触关系；2) 提示词要求的真实元素类别、子类型、机械拓扑、数量和朝向；3) 材质、服装、光线、环境和色彩；4) 动作或情绪词。第一、二级不可被后面的文字改写。\n\n保持导演台参考图的画幅比例、焦段观感、物体布局和前后层级；白模或方块只是占位几何体，只能在原包围盒、长宽高比例、朝向和交互关系内替换为目标真实元素。除非用户明确允许改变姿势，否则不要重新设计人物动作。${poseConstraints}\n不得移动、旋转、缩放、增删主体，不得把动作词解释为改变导演台未解锁的结构。\n\n${contentConstraints}\n${references.length > directorIndexes.length ? `除导演台参考图外，其余参考图只负责对应元素的身份、形状和细节；不得把不同参考图的元素混合、替换或遗漏。` : ""}\n\n用户要求：\n${text}\n\n【生成前一致性检查】先逐项检查：主体数量、主体位置、镜头方向、${poseCheck}、车辆/机械类别和关键部件是否同时满足；手部以自然完整为准，不要求与白模逐像素一致。任何结构项不满足都应回到参考图结构重做。`;
}

function buildDirectorContentConstraints(prompt: string) {
    const vehiclePattern = /车辆|汽车|卡车|拖拉机|农机|农业机械|工程车|挖掘机|tractor|vehicle|truck|excavator|john\s*deere/i;
    if (!vehiclePattern.test(prompt)) {
        return "目标元素必须保持提示词指定的真实类别和子类型，不得用泛化物体、混合物体或另一种机械替代；保留参考图中每个元素的数量、朝向、支撑关系和可见轮廓。";
    }

    if (/拖拉机|农机|农业机械|tractor|john\s*deere/i.test(prompt)) {
        return "目标元素是农业拖拉机/农机：必须呈现真实农业拖拉机拓扑，包括沿参考长轴排列的车身、发动机罩、驾驶位或驾驶室、底盘以及前后轮胎；车轮应有可信的轮距、大小差和地面接触。沿导演台参考图的长轴和视角放置，保持车辆在画面中的包围盒、朝向和与人物的相对位置；不得改成正面宽体卡车、越野车、工程车、玩具车或抽象方块，不得虚构悬空或断裂的车体。品牌名只用于车型类别和外形识别，除非用户明确要求，否则不要添加 logo 或文字。";
    }

    return "目标元素是车辆/工程机械：保持提示词指定的准确类别、关键部件、轮组或履带数量、结构比例和参考图朝向；不得替换成另一车型、正面海报式构图、玩具化模型或混合机械。车辆必须在原包围盒内与人物或道具保持可信支撑和接触。";
}

function chineseOrdinal(index: number) {
    const digits = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    if (index < digits.length) return digits[index];
    return String(index + 1);
}
