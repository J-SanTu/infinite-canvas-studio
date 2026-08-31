import { ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Empty, Select, Space, Table, Tag, Tooltip, message } from "antd";
import { useCallback, useEffect, useState } from "react";

import { listGenerationRuns, retryGenerationRun, type GenerationCapability, type GenerationRun, type GenerationRunStatus } from "@/services/api/generation-runs";

const statusLabels: Record<GenerationRunStatus, string> = {
    draft: "草稿",
    queued: "排队中",
    running: "运行中",
    succeeded: "已完成",
    retryable_failed: "可重试失败",
    failed: "失败",
    canceled: "已取消",
};

const statusColors: Record<GenerationRunStatus, string> = {
    draft: "default",
    queued: "processing",
    running: "processing",
    succeeded: "success",
    retryable_failed: "warning",
    failed: "error",
    canceled: "default",
};

export default function TasksPage() {
    const [runs, setRuns] = useState<GenerationRun[]>([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<GenerationRunStatus | undefined>();
    const [capability, setCapability] = useState<GenerationCapability | undefined>();
    const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
    const [messageApi, contextHolder] = message.useMessage();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listGenerationRuns({ status, capability, limit: 100 });
            setRuns(result.runs);
        } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "任务加载失败");
        } finally {
            setLoading(false);
        }
    }, [capability, messageApi, status]);

    useEffect(() => {
        void load();
    }, [load]);

    async function retry(run: GenerationRun) {
        if (retryingIds.has(run.id)) return;
        setRetryingIds((current) => new Set(current).add(run.id));
        try {
            const nextRun = await retryGenerationRun(run.id);
            messageApi.success(`已创建第 ${nextRun.attempt} 次重试任务`);
            await load();
        } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "重试失败");
        } finally {
            setRetryingIds((current) => {
                const next = new Set(current);
                next.delete(run.id);
                return next;
            });
        }
    }

    return (
        <main className="h-full overflow-y-auto bg-background">
            {contextHolder}
            <div className="mx-auto max-w-6xl px-6 py-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">任务中心</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">统一查看生成任务状态、错误原因和重试记录。</p>
                    </div>
                    <Space>
                        <Select allowClear placeholder="全部状态" value={status} onChange={(value) => setStatus(value || undefined)} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} style={{ width: 140 }} />
                        <Select
                            allowClear
                            placeholder="全部能力"
                            value={capability}
                            onChange={(value) => setCapability(value || undefined)}
                            options={[
                                { value: "image", label: "图片" },
                                { value: "video", label: "视频" },
                                { value: "audio", label: "音频" },
                                { value: "music", label: "音乐" },
                                { value: "text", label: "文本" },
                                { value: "director", label: "导演台" },
                            ]}
                            style={{ width: 140 }}
                        />
                        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} aria-label="刷新任务" />
                    </Space>
                </div>

                <div className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                    <Table
                        rowKey="id"
                        loading={loading}
                        dataSource={runs}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" /> }}
                        pagination={{ pageSize: 20, showSizeChanger: false }}
                        columns={[
                            {
                                title: "任务",
                                dataIndex: "operation",
                                render: (value: string, run) => (
                                    <div>
                                        <div className="font-medium">{value || "generation"}</div>
                                        <div className="text-xs text-stone-400">{run.id}</div>
                                        {run.parentRunId ? <div className="text-xs text-stone-400">重试链路 · 第 {run.attempt} 次</div> : run.attempt > 1 ? <div className="text-xs text-stone-400">第 {run.attempt} 次</div> : null}
                                    </div>
                                ),
                            },
                            { title: "能力", dataIndex: "capability", render: (value: string) => <Tag>{value}</Tag> },
                            { title: "模型", dataIndex: "modelId", render: (value: string) => value || "未指定" },
                            {
                                title: "状态",
                                dataIndex: "status",
                                render: (value: GenerationRunStatus) => (
                                    <Tag icon={value === "running" ? <SyncOutlined spin /> : undefined} color={statusColors[value]}>
                                        {statusLabels[value]}
                                    </Tag>
                                ),
                            },
                            { title: "尝试", dataIndex: "attempt", width: 70 },
                            {
                                title: "错误",
                                key: "error",
                                width: 220,
                                render: (_: unknown, run: GenerationRun) => {
                                    if (!run.errorMessageSafe && !run.errorCode) return <span className="text-stone-400">-</span>;
                                    const text = run.errorMessageSafe || run.errorCode || "任务失败";
                                    return (
                                        <Tooltip title={text}>
                                            <span className="block max-w-[200px] truncate text-red-600 dark:text-red-400">{text}</span>
                                        </Tooltip>
                                    );
                                },
                            },
                            { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString("zh-CN"), width: 180 },
                            {
                                title: "操作",
                                key: "actions",
                                width: 100,
                                render: (_: unknown, run: GenerationRun) =>
                                    run.status === "retryable_failed" || run.status === "failed" ? (
                                        <Button type="link" size="small" loading={retryingIds.has(run.id)} disabled={retryingIds.has(run.id)} onClick={() => void retry(run)}>
                                            重试
                                        </Button>
                                    ) : null,
                            },
                        ]}
                    />
                </div>
            </div>
        </main>
    );
}
