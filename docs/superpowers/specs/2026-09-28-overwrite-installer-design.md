# 同版本覆盖安装与交付

沿用用户已批准的覆盖安装计划，版本保持 0.5.0。

- Mac PKG 固定替换 /Applications/Santu Infinite Canvas.app，备份旧应用，保留用户数据；已连续安装两次并验证启动与历史画布。
- Windows NSIS 保持 cn.santu.infinitecanvas 标识，复用注册表记录的安装目录，固定快捷方式名称，关闭更改安装目录，卸载不删除用户数据。不清理任意 ZIP 解压副本。
- 安装包公开输出到 macOS/ 与 Windows/，中间构建放 .build.noindex；自动构建同步这些路径。
- 上传现有 v0.5.0，逐个核验大小和 SHA256；README 中英文使用附件真实下载地址，推荐安装版。不新增版本说明。
- Windows 当前仅能完成配置、编译及包内容检查，Windows 实机覆盖与启动需另行验收，不声称已测试。
