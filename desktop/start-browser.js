import { spawn } from "node:child_process";

const { startServer, stopServer } = await import("../server.js");

try {
    const local = await startServer({ port: Number(process.env.PORT || 5200), host: "127.0.0.1" });
    openBrowser(local.url);
    console.log("Keep this window open. Press Ctrl+C to stop.");
} catch (error) {
    console.error(`Startup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        void stopServer().finally(() => process.exit(0));
    });
}

function openBrowser(url) {
    const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
}
