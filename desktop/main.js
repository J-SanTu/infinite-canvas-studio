import { logEvent } from "../server/lib/diagnostic-log.js";
import { app, BrowserWindow, shell } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let mainWindow = null;
let localServer = null;
let quitting = false;

app.setName("Santu Infinite Canvas");
app.setPath("userData", process.env.SANTU_QA_DATA_DIR || join(app.getPath("appData"), "santu-infinite-canvas"));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

app.whenReady().then(async () => {
    try {
        const dataRoot = app.getPath("userData");
        process.env.CANVAS_LOG_PATH = join(dataRoot, "logs");
        await mkdir(dataRoot, { recursive: true });
        logEvent("info", "desktop.start", { version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node });
        process.on("uncaughtExceptionMonitor", (error) => logEvent("error", "desktop.uncaught_exception", { error }));
        process.on("unhandledRejection", (error) => logEvent("error", "desktop.unhandled_rejection", { error }));
        process.env.CANVAS_DB_PATH = join(dataRoot, "app-db.json");
        process.env.CANVAS_STORAGE_PATH = join(dataRoot, "storage");
        process.env.CANVAS_SECRET_PATH = join(dataRoot, "api-secret.key");
        process.env.CANVAS_IMAGE_USAGE_DB_PATH = join(dataRoot, "image-usage.sqlite");
        process.env.CANVAS_IMAGE_USAGE_OUTBOX_PATH = join(dataRoot, "image-usage-outbox.ndjson");
        process.env.CANVAS_ASSET_CHANGE_DB_PATH = join(dataRoot, "asset-changes.sqlite");
        process.env.CANVAS_DIST_PATH = join(app.getAppPath(), "dist");

        const serverModule = await import(pathToFileURL(join(app.getAppPath(), "server.js")).href);
        localServer = await serverModule.startServer({ port: 0, host: "127.0.0.1", openLogDirectory: async (path) => { const error = await shell.openPath(path); if (error) throw new Error(error); } });
        mainWindow = createWindow();
        await mainWindow.loadURL(localServer.url);
    } catch (error) {
        logEvent("error", "desktop.start_failed", { error });
        console.error("Desktop startup failed", error);
        app.quit();
    }
});

app.on("activate", () => {
    if (!mainWindow && localServer) {
        mainWindow = createWindow();
        void mainWindow.loadURL(localServer.url);
    }
});

app.on("before-quit", async (event) => {
    if (quitting || !localServer?.server?.listening) return;
    event.preventDefault();
    quitting = true;
    logEvent("info", "desktop.quit");
    try {
        await new Promise((resolve) => localServer.server.close(resolve));
    } finally {
        app.quit();
    }
});

app.on("window-all-closed", () => {
    app.quit();
});

function createWindow() {
    const window = new BrowserWindow({
        icon: join(app.getAppPath(), "build", "icon.png"),
        width: 1440,
        height: 920,
        minWidth: 1080,
        minHeight: 700,
        show: false,
        backgroundColor: "#f7f7f5",
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    window.webContents.on("render-process-gone", (_event, details) => logEvent("error", "desktop.renderer_gone", details));
    window.webContents.on("did-fail-load", (_event, code, description) => logEvent("error", "desktop.load_failed", { code, description }));
    window.webContents.on("console-message", (_event, level, message) => { if (level >= 2) logEvent(level >= 3 ? "error" : "warn", "desktop.renderer_console", { message }); });
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
        mainWindow = null;
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
        if (localServer && new URL(url).origin !== new URL(localServer.url).origin) event.preventDefault();
    });
    return window;
}
