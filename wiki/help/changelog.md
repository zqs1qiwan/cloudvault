# 版本记录

完整的版本、提交和下载包以 GitHub Releases 为准：

- [CloudVault Releases](https://github.com/zqs1qiwan/cloudvault/releases)
- [提交历史](https://github.com/zqs1qiwan/cloudvault/commits/main)

当前文档对应版本：**v1.14.7**。

## 产品里程碑

### 账号体系

- 首个管理员通过 `/setup` 创建；
- 多成员、`admin` / `user` 角色；
- PBKDF2 密码、7 天会话；
- 管理员重置密码、最后一个管理员保护；
- WebDAV 使用同一套账号。

### 存储层

- R2 成为唯一文件真相源；
- 移除独立文件索引；
- 文件夹用前缀 + `.cv-folder` 标记；
- 重命名 / 移动同步重定向分享；
- ZIP 流式生成，Range 单次读取。

### 分享与公开页

- 单文件分享：密码、有效期、下载计数；
- 文件夹分享链接；
- 访客页面、文件夹共享、子目录排除；
- 公开简洁地址；
- 分享密码 Cookie 限定路径。

### 访问方式

- WebDAV Class 1；
- 文件夹 `PROPFIND`、`MOVE`、`COPY`；
- `Depth: infinity` 上限保护；
- 条件写入 `If-Match` / `If-None-Match`。

### 文档与品牌

- 统一品牌色和云 + 钥匙孔标志；
- README 功能截图与说明；
- `Build your own` 页脚；
- VitePress 文档站，覆盖使用、配置、安全和开发。

## 升级提示

- 升级只替换 Worker 代码，不迁数据；
- 升级前看对应 Release 的说明；
- 破坏性变更会在 Release 里单独标注；
- 不要通过删除 KV 来“重置”实例。

## 文档站本身

文档站位于仓库 `wiki/`，通过 GitHub Pages 发布。发现文档错误可以直接提 PR，不需要改应用代码。
