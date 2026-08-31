import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { parseChangelog } from "./src/lib/release";
import { APP_API_PROXY_PREFIX, APP_BASE_URL } from "./src/config/app-config";

const webDir = dirname(fileURLToPath(import.meta.url));
const versionPath = existsSync(resolve(webDir, "VERSION")) ? resolve(webDir, "VERSION") : resolve(webDir, "../VERSION");
const changelogPath = existsSync(resolve(webDir, "CHANGELOG.md")) ? resolve(webDir, "CHANGELOG.md") : resolve(webDir, "docs/CHANGELOG.md");
const localVersion = readFileSync(versionPath, "utf8").trim() || "dev";
const localChangelog = readFileSync(changelogPath, "utf8");
const providerProxy = {
    target: APP_BASE_URL,
    changeOrigin: true,
    secure: false,
    rewrite: (path: string) => path.replace(new RegExp(`^${APP_API_PROXY_PREFIX}`), ""),
};
const backendProxy = {
    target: process.env.BACKEND_URL || "http://127.0.0.1:5202",
    changeOrigin: true,
    secure: false,
};

export default defineConfig({
    root: webDir,
    cacheDir: process.env.VITE_CACHE_DIR || resolve(webDir, "node_modules/.vite"),
    publicDir: resolve(webDir, "public"),
    base: process.env.VITE_BASE || "/",
    plugins: [react()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
    server: {
        fs: {
            allow: [webDir],
        },
        hmr: {
            overlay: false,
        },
        proxy: {
            "/api": backendProxy,
            [APP_API_PROXY_PREFIX]: providerProxy,
        },
    },
    preview: {
        proxy: {
            "/api": backendProxy,
            [APP_API_PROXY_PREFIX]: providerProxy,
        },
    },
});
