type UnderDevelopmentPageProps = {
    title: string;
};

export function UnderDevelopmentPage({ title }: UnderDevelopmentPageProps) {
    return (
        <main className="flex h-full items-center justify-center overflow-hidden bg-background text-stone-950 dark:text-stone-100">
            <div className="text-center">
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">正在开发中</p>
            </div>
        </main>
    );
}

