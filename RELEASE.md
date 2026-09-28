# 安装包更新与 GitHub 交付

版本保持 0.5.0，同版本修复更新现有 Release，不新增版本报告。

## 打包

- Windows：`pnpm pack:win`，产物 `Windows/Santu-Infinite-Canvas-0.5.0-Windows-setup.exe`。
- Apple 芯片 Mac：`pnpm pack:mac`，产物 `macOS/Santu-Infinite-Canvas-0.5.0-arm64.pkg`。
- 中间产物放在 `.build.noindex`；安装文件和用户数据均不提交到 Git。
- Windows ZIP 可使用 `pnpm pack:win:zip` 另行生成；它不支持固定位置覆盖安装。

## 更新行为

Mac PKG 固定覆盖 /Applications/Santu Infinite Canvas.app，备份旧应用并保留用户数据。Windows 安装版复用现有安装目录，保持应用标识和快捷方式名称，保留用户数据。安装前退出软件。任意目录中的 ZIP 解压副本不会被自动清理。

## 上传顺序

1. 检查目标仓库 J-SanTu/infinite-canvas-studio 和已有 v0.5.0。
2. 逐个上传安装包；等待完成，核验附件状态、字节数和 SHA256。只重试未完成文件。
3. 用 API 返回的 browser_download_url 更新 README.md 及 README.zh-CN.md，包含 README 中内嵌的中文段落。
4. 推送审核后的源码，更新源码 ZIP；确认远程 main 和下载链接。

详情见 [GitHub 上传规则](docs/GitHub上传规则.md)。Mac 当前 PKG 未进行 Developer ID Installer 签名或 Apple 公证。Windows 包编译和内容检查通过不等于实机安装验证。
