import { AppConfigPanel } from "@/components/layout/app-config-modal";

export default function ConfigPage() {
    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-6">
                <div className="mb-5">
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">本地设置</h1>
                    <p className="mt-1 text-sm text-stone-500">API、模型、生成偏好与本地数据同步</p>
                </div>
                <AppConfigPanel />
            </div>
        </main>
    );
}
