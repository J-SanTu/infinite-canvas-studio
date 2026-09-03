# Santu Infinite Canvas

**English** · [简体中文](./README.zh-CN.md)

Santu Infinite Canvas is a local-first, single-user AI creative desktop workspace. It connects prompts, references, generated media, and delivery work on one reusable canvas without requiring an account.

<p align="center">
  <img src="./assets/readme/hero-en.svg" width="100%" alt="Santu Infinite Canvas: a connected workflow from prompt and image input to reusable visual delivery">
</p>

## Product model

- One local workspace per computer; no login, employee management, roles, or tenant administration
- Local canvas projects, assets, prompt library, generated media, and task history
- Separate local API settings for image, text, video, audio, and music providers
- API credentials are encrypted at rest by the local Node service and are never returned to the browser
- The production Node service serves both the built web app and `/api`
- Electron desktop shell for Windows installer and portable builds

<p align="center">
  <img src="./assets/readme/workflow-en.svg" width="100%" alt="Five-step Santu workflow: collect, connect, generate, preview, and deliver">
</p>

## Features

- Infinite canvas with movable, connected, and reusable nodes
- Image generation, editing, references, outpainting, and upscaling
- Video, audio, and music workflows with retryable task records
- Director workspace for scenes, cameras, timelines, and PNG/MP4 exports
- Local project library, assets, prompt library, import, export, and automatic persistence

## Director workspace

The embedded Director workspace contains source-level adaptations and compatible assets derived from [MONOFORM Previs Studio](https://github.com/GuiYi-Xi/monoform-previs-studio). Its focused previs workflow includes:

- Building scenes with characters, primitive geometry, props, and imported GLB/GLTF models
- Posing rigged characters with presets, bone controls, IK handles, and optional reference images
- Managing multiple shots with independent scenes, camera framing, focal lengths, aspect ratios, and thumbnails
- Animating cameras, characters, and scene objects on a keyframe timeline
- Exporting camera views as PNG, timeline previews as MP4, and editable projects as JSON

Original MONOFORM resources:

- [Watch the 8-minute getting-started video](https://guiyi-xi.github.io/monoform-previs-studio/tutorial/monoform-getting-started.mp4)
- [Read the original user guide](https://github.com/GuiYi-Xi/monoform-previs-studio/blob/main/docs/USER_GUIDE.md)
- [View the source project](https://github.com/GuiYi-Xi/monoform-previs-studio)

The points above are summarized from the upstream README. Santu adapts the embedded workspace for its infinite-canvas, local persistence, and screenshot-return workflow, so some interface details may differ from the original tutorial.

## Run from source

Requirements: Node.js 24 or later and pnpm.

```bash
pnpm install
pnpm build
pnpm start
```

Open `http://127.0.0.1:5200`. The production command runs one Node process and serves the files in `dist/`; Vite is not required at runtime.

- macOS: double-click `启动.command`
- Windows: double-click `启动-Windows.bat`
- Development only: run `pnpm dev:backend` and `pnpm dev` in separate terminals

## Desktop app

### Install the packaged app

For end users, use the direct download for your platform:

- Windows: [download the Windows ZIP](https://github.com/J-SanTu/infinite-canvas-studio/releases/download/v0.2.0/Santu.Infinite.Canvas-0.2.0-win.zip), extract it, and run `Santu Infinite Canvas.exe`.
- macOS Apple Silicon: [download the DMG](https://github.com/J-SanTu/infinite-canvas-studio/releases/download/v0.2.0/Santu.Infinite.Canvas-0.2.0-arm64.dmg), open it, and drag the app to Applications. The app is unsigned; on first launch use Control-click, choose **Open**, and confirm.

The packaged apps include their runtime and do not require Node.js, pnpm, or a separate launcher.

### Run from the source bundle

This repository contains the upload-ready source. To run it locally, open a terminal in the repository root:

```bash
pnpm install
pnpm build
pnpm start
```

Then open `http://127.0.0.1:5200`. Do not upload `node_modules`, generated `dist`, or local platform archives.

```bash
pnpm desktop
```

Build the Windows installer and portable executable on Windows:

```bash
pnpm pack:win
```

Build macOS Apple Silicon DMG and ZIP packages:

```bash
pnpm pack:mac
```

Windows artifacts are written to the top-level `Windows/` folder; macOS artifacts are written to the top-level `macOS/` folder. These folders contain delivery packages only and are ignored by Git. See [RELEASE.md](./RELEASE.md) for separate GitHub upload instructions.

For a clean handoff, use `最终交付/`, which contains exactly two archives: `Santu Infinite Canvas-0.2.0-win.zip` and `Santu Infinite Canvas-0.2.0-mac.zip`.

On an Apple Silicon Mac, `pnpm pack:win:zip` creates the Windows x64 ZIP. Use the Windows GitHub Actions workflow for the installer and portable EXE.

Electron starts the local service on a random loopback port and stores runtime data in the operating system's application-data directory. Closing the desktop app stops the service.

## First launch

The local API settings page opens automatically when no provider has been configured. Each capability accepts:

- Base URL
- API Key
- Model names

Keys stay in local runtime data and are excluded from project exports. Do not commit `.env`, `server/data/`, `Windows/`, `macOS/`, generated media, or provider credentials.

## Verification

```bash
pnpm typecheck
pnpm build
pnpm test:local
pnpm test:top-nav-static-ui
pnpm test:director-static-ui
```

## Project layout

- `src/` - React UI, canvas, local project library, media workflows, and settings
- `server/` - local storage, encrypted API configuration, provider proxy, and task records
- `desktop/` - Electron main process and desktop startup
- `dist/` - production frontend generated by Vite
- `public/` - static assets and the Director workspace bundle
- `Windows/` - local Windows delivery packages (ignored by Git)
- `macOS/` - local macOS delivery packages (ignored by Git)
- `最终交付/` - two final ZIP bundles for handoff (ignored by Git)

## License and attribution

See [LICENSE](./LICENSE) and [UPSTREAM.md](./UPSTREAM.md). Runtime projects, API credentials, generated media, and local databases are not part of the repository.
