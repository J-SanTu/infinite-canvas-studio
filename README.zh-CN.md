# Santu 无限画布

[EN](./README.md#santu-infinite-canvas) · [中文](./README.md#santu-无限画布)

Santu 无限画布是一套本地优先、单机单用户的 AI 创作桌面工作区。它把提示词、参考素材、生成任务和交付内容连接在同一张可复用画布中，打开后无需注册或登录。

<p align="center">
  <img src="./assets/readme/hero-zh.svg" width="100%" alt="Santu 无限画布：从提示词和图片输入到可复用视觉交付的连接式工作流">
</p>

## 版本规则

- 每台电脑只有一个本地工作区，不包含账号、员工、角色、租户或管理员体系
- 画布项目、素材、提示词、生成媒体和任务记录保存在本机
- 图片、文本、视频、音频和音乐 API 分开配置
- API Key 由本地 Node 服务加密保存，不会通过接口返回给浏览器
- 正式运行时由同一个 Node 服务提供 `dist` 页面和 `/api`
- 使用 Electron 生成 Windows 安装版和便携版

<p align="center">
  <img src="./assets/readme/workflow-zh.svg" width="100%" alt="Santu 五步工作流：收集、连接、生成、预演和交付">
</p>

## 功能

- 支持移动、连接和复用节点的无限画布
- 图片生成、编辑、参考图、扩图和超分
- 视频、音频、音乐工作流与可重试任务记录
- 导演台：场景、镜头、时间轴以及 PNG / MP4 导出
- 本地项目列表、素材库、提示词库、导入导出和自动保存

## 导演台

本项目内嵌的导演台包含源自 [MONOFORM 素形白模预演工作台](https://github.com/GuiYi-Xi/monoform-previs-studio) 的源码级适配和兼容资源，主要预演能力包括：

- 使用人物、基础几何体、场景道具和导入的 GLB / GLTF 模型快速搭建场景
- 通过动作预设、骨骼控制点、手脚 IK 和参考图调整人物姿势
- 点击场景物体或关节点后，按 `W` 移动、按 `E` 旋转；按 `Q` 返回人物摆姿/选择模式
- Blender 式视图：小键盘 `1` 前视、`3` 右视、`7` 顶视、`9` 左视
- 管理多个独立镜头，设置摄像机构图、焦距、画幅比例和镜头缩略图
- 在时间轴上为摄像机、人物和场景物体制作关键帧动画
- 将摄像机画面导出为 PNG、将时间轴预演导出为 MP4，并用 JSON 工程文件继续编辑

MONOFORM 原项目资料：

- [观看约 8 分钟的入门操作视频](https://guiyi-xi.github.io/monoform-previs-studio/tutorial/monoform-getting-started.mp4)
- [查看原版使用说明](https://github.com/GuiYi-Xi/monoform-previs-studio/blob/main/docs/USER_GUIDE.md)
- [查看功能来源项目](https://github.com/GuiYi-Xi/monoform-previs-studio)

以上要点根据源项目 README 归纳。Santu 内嵌版已针对无限画布、本地保存和截图回传流程进行适配，因此部分界面细节可能与原教程略有不同。

## 从源码运行

需要 Node.js 24 或更高版本以及 pnpm。

```bash
pnpm install
pnpm build
pnpm start
```

打开 `http://127.0.0.1:5200`。正式运行只启动一个 Node 进程，由它直接提供 `dist/` 文件，不再依赖 Vite 开发服务器。

- macOS：双击 `启动.command`
- Windows：双击 `启动-Windows.bat`
- 开发模式：分别运行 `pnpm dev:backend` 和 `pnpm dev`

## 桌面版

### 安装已打包版本

普通用户可直接选择对应平台下载：

- Windows：[下载 Windows ZIP](https://github.com/J-SanTu/infinite-canvas-studio/releases/download/v0.3.0/Santu.Infinite.Canvas-0.3.0-win.zip)，解压后运行 `Santu Infinite Canvas.exe`。
- Apple 芯片 macOS：[下载 DMG](https://github.com/J-SanTu/infinite-canvas-studio/releases/download/v0.3.0/Santu.Infinite.Canvas-0.3.0-arm64.dmg)，打开后将应用拖到“应用程序”。应用当前未签名，首次启动请按住 Control 点击，选择“打开”并确认。

打包应用已包含运行所需环境，不需要另外安装 Node.js、pnpm，也不需要启动脚本。

### 从源码文件夹运行

当前仓库已经包含完整源码。在仓库根目录打开终端：

```bash
pnpm install
pnpm build
pnpm start
```

然后打开 `http://127.0.0.1:5200`。不要上传 `node_modules`、生成的 `dist` 或本地平台 ZIP 包。

本机启动 Electron：

```bash
pnpm desktop
```

在 Windows 上生成安装版和便携版：

```bash
pnpm pack:win
```

生成 macOS Apple 芯片版 DMG 和 ZIP：

```bash
pnpm pack:mac
```

Windows 产物写入项目根目录的 `Windows/`，macOS 产物写入项目根目录的 `macOS/`。这两个目录只放交付包，并已加入 Git 忽略规则。分平台上传 GitHub 的方法见 [RELEASE.md](./RELEASE.md)。

交付时可使用上方链接中的 v0.3.0 Windows ZIP 和 macOS ARM64 DMG；发布页还提供源码、macOS ZIP、Windows 安装版和便携版。

Apple 芯片 Mac 可运行 `pnpm pack:win:zip` 生成 Windows x64 ZIP；安装版和便携版 EXE 请使用 Windows GitHub Actions 工作流生成。

Electron 会在随机的本机回环端口启动服务，并把数据库、素材、密钥和运行记录保存到操作系统的应用数据目录。关闭桌面应用时，本地服务同时退出。

## 首次启动

当本机还没有任何服务商配置时，应用会自动打开 API 设置。每项配置包含：

- Base URL
- API Key
- 模型名称

密钥不会写入浏览器存储，也不会进入项目导出文件。不要提交 `.env`、`server/data/`、`Windows/`、`macOS/`、生成媒体或服务商凭据。

## 验证

```bash
pnpm typecheck
pnpm build
pnpm test:local
pnpm test:top-nav-static-ui
pnpm test:director-static-ui
```

## 项目结构

- `src/` - React 界面、无限画布、本地项目管理、媒体工作流和设置
- `server/` - 本地存储、加密 API 配置、服务商代理和任务记录
- `desktop/` - Electron 主进程和桌面启动逻辑
- `dist/` - Vite 生成的正式前端
- `public/` - 静态资源与导演台工作区
- `Windows/` - 本地 Windows 交付包（Git 忽略）
- `macOS/` - 本地 macOS 交付包（Git 忽略）
- `最终交付/` - 仅含两个最终 ZIP 的交付目录（Git 忽略）

## 许可证与署名

许可证和上游来源请查看 [LICENSE](./LICENSE) 与 [UPSTREAM.md](./UPSTREAM.md)。本地项目、API 凭据、生成媒体和运行数据库不属于仓库内容。
