## v0.3.0 - 2026-09-22

### 修复

- 修复导演台工程保存失败：工程按导演台节点隔离保存，避免固定存储键导致工程读写错位。
- 修复新画布刚打开时的保存时序问题：画布项目尚未完成同步时，先保存导演工程快照，后续自动保存再补关联。
- 修复摄像机视角无法操作：恢复旋转、平移、缩放控制，并将相机位置和旋转写回主摄像机。
- 修复摄像机视角切换后的画面更新，避免每帧重新覆盖用户调整的镜头位置。
- 保留固定姿势不可循环的正确限制；连续动作仍可使用循环播放。
- 修复生成图片比例处理，改为完整保留画面并补白边，避免自动裁切内容。

### 文档与发布

- 新增面向新手的导演台完整使用指南，覆盖对象、工具、摄像机、动作、时间轴、截图、视频导出和常见问题。
- 清理旧版本发布入口，统一当前版本为 `v0.3.0`。
- Mac 与 Windows 交付目录统一使用 0.3.0 命名。

## v0.2.3 - 2026-09-22

- Fix Director workspace project persistence per canvas node.
- Restore camera view orbit, pan, zoom, and camera position write-back.
- Add beginner-friendly Director workspace usage guide.
- Refresh macOS and Windows desktop release assets.

# Changelog

## v0.2.2 - 2026-09-16

- Add GPT Image 2.5 Flare and Sunburst to the image model defaults and backend catalog, using the existing image API.
- Align image size processing with the 1.0 workspace implementation.
- Include the existing 8K export and persisted toolbar preferences.
- Rebuild macOS ARM64 and Windows x64 desktop distributions from the same source.

## v0.2.1 - 2026-09-14

+ [修复] 指定尺寸输出完整保留画面，比例不符时补白边，不再居中裁切。
+ [新增] AI 细节增强后等比输出长边 8192 像素 PNG，普通插值放大也支持 8K。
+ [修复] 点击画布空白处关闭图片二次编辑工具栏。
+ [修复] 快捷工具文字默认隐藏，保存的设置写入本地数据库并在重启后恢复。

## Unreleased

- Removed the top-bar and camera-monitor watermarks from the Director workspace.
- Restored Director `Q`, `W`, `E`, and `R` shortcuts across the embedded iframe boundary; `Q` now enters character posing and IK selection mode.
- Added Blender-style Director view shortcuts: numpad `1` front, `3` right, `7` top, and `9` left.
- Changed Director character joint markers from low-contrast gold to high-contrast red.
- Kept selected scene objects compatible with the move and rotate toolbar tools and their `W` / `E` shortcuts.

## v0.2.0-local

- Reworked the product as a single-user local desktop workspace with no login, employee, role, tenant, or administrator flow.
- Added independent encrypted local API settings for image, text, video, audio, and music providers.
- Made the Node service serve the production `dist` application and `/api` from one process.
- Added Electron desktop startup, Windows installer/portable targets, and macOS/Windows source launchers.
- Separated Windows and macOS release artifacts, checksums, build commands, and GitHub Actions workflows.
- Migrated legacy ownership records into the one local workspace while preserving projects, assets, prompts, and task history.
- Replaced multi-user tests and documentation with local-workspace release rules.

## v0.1.1

- Replaced the dense dark README artwork with a restrained Japanese editorial visual system.
- Added matching English and Simplified Chinese hero/workflow visuals and README pages.

## v0.1.0-santu

- Initial public Santu Infinite Canvas release.
- Included the canvas, media workflows, multi-user administration, usage reports, and Santu-branded Director workspace.
- This architecture was replaced by the local desktop model in v0.2.0-local.
