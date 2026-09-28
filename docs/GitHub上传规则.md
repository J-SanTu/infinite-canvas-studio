# GitHub 同版本更新与上传规则

- 在实际源码仓库执行操作；先检查远程提交和 Release 状态。
- 只提交源码与图标资源，禁止提交 node_modules、安装包、解包目录、用户数据库、素材或密钥。提交前检查暂存清单与大文件。
- 本地历史混入大文件时，从远程主分支建立干净工作分支，拷贝审核后的源码形成新提交；不要全历史清理或强推主分支。
- 同版本修复继续使用现有 v0.5.0，不创建新标签，不添加新版发布报告。
- Electron 下载出现 DNS 失败时，在获准联网的执行环境重试。Git HTTP/2 错误可单次使用 git -c http.version=HTTP/1.1 push。
- 先检查 gh auth status；只有确认认证失败后才重新进行设备授权，不把沙箱网络失败误判为令牌失效。
- 安装包分批上传：先上传一至两个，核对附件状态及大小，再上传下一批。没有输出不代表失败，不因短暂静默中断任务。
- 上传失败后先读取现有附件，跳过校验通过的文件，仅重试缺失或内容不符的文件。
- 以 GitHub API 返回的 browser_download_url 为准同步 README.md 和 README.zh-CN.md。GitHub 可能把空格改成点号，不猜测最终名称。
- 每个 Release 只保留本版本中文说明，禁止把整个 CHANGELOG.md 用作发布正文。
- 发布完成分别核对远程源码提交、附件名称/大小/SHA256、README 链接；不能把本地完成说成远程完成。

## DMG 挂载保护

替换本地 DMG 前先检查 hdiutil info。若目标文件仍被挂载，不得原地覆盖；使用不同文件名交付，或先正常退出安装盘。验证不仅包括签名和 SHA256，还必须从重新挂载的镜像复制应用并实际启动，检查本地页面响应。旧挂载出现 errno=5 时应重新挂载，不能据此认定运行库未打包。

## 覆盖安装包交付

- 默认推荐 macOS PKG 与 Windows setup.exe。保持 appId、应用名和快捷方式名不变；Windows 使用已有注册表安装目录，Mac 固定 /Applications。
- `pnpm pack:mac` 输出 macOS/*.pkg；`pnpm pack:win` 输出 Windows/*-Windows-setup.exe；中间应用目录使用 .build.noindex。
- 同版本更新先上传新命名附件并校验，再将 README.md（包括内嵌中文段落）和 README.zh-CN.md 的旧 DMG/ZIP 推荐链接替换为新安装包的真实 browser_download_url。上传未完成不能将链接视为已生效。
- 保留既有发布正文，不创建新版本报告；无需删除旧附件来完成链接切换。
- Windows 无实机测试时仅报告编译和包内容检查通过，不宣称已完成实际覆盖测试。
