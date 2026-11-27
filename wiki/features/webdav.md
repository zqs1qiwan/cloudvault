# WebDAV

WebDAV 让你把 CloudVault 当成网络硬盘使用，而不必打开网页。

## 地址与认证

```text
https://<your-host>/dav/
```

- 认证方式：HTTP Basic Auth；
- 用户名 / 密码：和网页登录完全相同的账号；
- 必须使用 HTTPS；Cloudflare 默认提供 TLS；
- 每个账号都可以使用 WebDAV，包括 `admin` 和 `user`；
- 访客和分享 token 不能用于 WebDAV。

Basic 认证在每次请求里携带凭据。CloudVault 在 Worker 内存里缓存已验证的凭据 60 秒，避免每个请求都做一次 PBKDF2；缓存键是摘要，不是密码本身。

## 支持的方法

| 方法 | 支持 | 说明 |
| --- | --- | --- |
| `OPTIONS` | 是 | 返回 `DAV: 1` 和能力列表 |
| `PROPFIND` | 是 | `Depth: 0` / `1` / `infinity` |
| `GET` / `HEAD` | 是 | 文件读取，支持 Range |
| `PUT` | 是 | 新建或覆盖文件 |
| `DELETE` | 是 | 文件或整个文件夹 |
| `MKCOL` | 是 | 创建文件夹 |
| `MOVE` / `COPY` | 是 | 文件和文件夹 |
| `PROPPATCH` | 否 | 返回 501 |
| `LOCK` / `UNLOCK` | 否 | 返回 501 |

因此 CloudVault 是 **WebDAV Class 1**，不是 Class 2。依赖文件锁的客户端（例如某些 Office 直接编辑场景）不适合用它做协作编辑。

## 挂载示例

### rclone

```bash
rclone config
```

选择：

```text
Storage: WebDAV
URL: https://<your-host>/dav/
Vendor: Other
User: <username>
Pass: <password>
```

或者写一个 remote：

```bash
rclone lsd cloudvault:
rclone copy ./local-folder cloudvault:Projects/
```

rclone 对 `Depth: infinity` 和分页的处理比较可靠，通常是首选客户端。

### macOS Finder

1. Finder → **前往** → **连接服务器**；
2. 输入 `https://<your-host>/dav/`；
3. 使用账号密码登录。

Finder 的 WebDAV 实现比较挑剔：如果连接后目录为空或反复认证，先用 rclone 验证账号和路径，再检查系统代理、证书和 URL 末尾的 `/`。

### Windows 资源管理器

1. **映射网络驱动器**；
2. 地址填 `https://<your-host>/dav/`；
3. 输入账号密码。

Windows 对自签名证书和 Basic 认证有额外限制。Cloudflare 的正式域名通常没有问题；如果失败，改用 rclone 或 Cyberduck。

### Cyberduck

新建 WebDAV 连接，URL 填 `https://<your-host>/dav/`，勾选 HTTPS，输入账号密码。

## 文件夹与路径

DAV 根 `/dav/` 对应 CloudVault 的根目录。路径会按 URL 编码解析：

```text
/dav/Projects/2026/brief.pdf
→ R2 key: Projects/2026/brief.pdf
```

- 路径段不能是 `.` / `..`；
- 不允许反斜杠；
- 文件夹可以不存在于“索引”，但只要前缀下有内容就能 `PROPFIND`；
- `MKCOL` 会写入 `.cv-folder` 标记，让空文件夹存在。

## Depth: infinity

`PROPFIND Depth: infinity` 会做真正的递归遍历，但有上限：

```text
最多 5000 个条目
```

超过时返回 `403` 和：

```xml
<D:error xmlns:D="DAV:">
  <D:propfind-finite-depth/>
</D:error>
```

这是为了让超大目录“明确失败”，而不是返回一个不完整的树。遇到这个错误时：

- 用 `Depth: 1` 分目录遍历；
- 或换 rclone 的按目录同步策略。

## 条件写入

`PUT` 支持：

- `If-Match`：只有 ETag 匹配才覆盖；
- `If-None-Match: *`：只有目标不存在才创建。

这让同步客户端可以避免“覆盖了别人刚改的文件”。`GET` 也支持 `If-None-Match` / `If-Modified-Since` 的 304。

## 移动与复制

- 文件：复制后删除源（MOVE）或只复制（COPY）；
- 文件夹：递归复制子树，MOVE 再删除源；
- `Overwrite: F` 时目标存在返回 412；
- 目标父目录不存在返回 409；
- 不能把文件夹复制到自身内部。

文件夹重命名 / 移动会同步重定向文件夹分享标记和链接。

## 账号与安全

- WebDAV 使用网页账号；改密码后，旧密码在 Basic 缓存过期后失效（最多 60 秒）；
- 管理员重置某个成员的密码会撤销其网页会话，但 DAV 的旧 Basic 凭据也应在缓存过期后失效；
- `/dav` 的失败认证按 IP 限流，10 分钟最多 20 次；
- 如果前面加了 Cloudflare Access，WebDAV 客户端需要额外的 service token 或绕过策略，否则会卡在登录页。见 [Cloudflare Access](/security/access)。

## 常见错误

| 状态 | 含义 |
| --- | --- |
| 401 | 没有凭据、用户名密码错误，或账号不存在 |
| 403 `propfind-finite-depth` | 递归条目超过 5000 |
| 405 | 对集合 `PUT`，或对根 `MKCOL` |
| 409 | 目标父目录不存在，或复制到自身 |
| 412 | `If-Match` / `If-None-Match` 条件失败，或 `Overwrite: F` 目标已存在 |
| 501 | `LOCK` / `UNLOCK` / `PROPPATCH` 未实现 |
