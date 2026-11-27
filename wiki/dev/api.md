# API

CloudVault 的私有 API 使用同源 Cookie 会话；公开分享使用 token。没有 API Key，也没有 OAuth。

## 约定

- 基础路径：`/api`
- 请求 / 响应：JSON，上传和下载除外
- 认证：`session` Cookie（HttpOnly）
- 错误：`{ "error": "message" }`，HTTP 状态码表达类别
- 时间：ISO 8601 字符串
- key：文件的 R2 对象键，需要 URL 编码

在浏览器里调用时带上凭据：

```js
await fetch('/api/files?folder=Projects', { credentials: 'include' });
```

## 私有接口

### 文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/files?folder=&cursor=` | 列出目录，分页 |
| `GET` | `/api/bootstrap?folder=` | 一次取目录、文件夹树、统计等首屏数据 |
| `GET` | `/api/files/meta?key=` | 单文件元数据 |
| `GET` | `/api/files/download?key=` | 下载，支持 Range |
| `GET` | `/api/files/preview?key=` | 内联预览，支持 Range |
| `GET` | `/api/files/thumbnail?key=` | 图片缩略图 |
| `PUT` | `/api/files/rename` | 重命名文件 |
| `POST` | `/api/files/delete` | 批量删除 |
| `POST` | `/api/files/move` | 批量移动 |
| `POST` | `/api/files/zip` | 流式 ZIP |
| `POST` / `PUT` | `/api/files/upload` | 直传或分片 |
| `POST` | `/api/files/sync` | 刷新统计快照 |

请求体：

```json
// PUT /api/files/rename
{ "key": "Projects/a.pdf", "name": "b.pdf" }

// POST /api/files/delete
{ "ids": ["Projects/a.pdf", "Projects/b.pdf"] }

// POST /api/files/move
{ "ids": ["Projects/a.pdf"], "targetFolder": "Archive" }

// POST /api/files/zip
{ "ids": ["Projects/a.pdf", "Projects/b.pdf"] }
```

上传：

```http
POST /api/files/upload
X-File-Name: <url-encoded name>
X-Folder: <url-encoded folder, optional>
Content-Type: <mime>
<binary body>
```

分片上传使用同一路径的查询参数：

| 查询 | 作用 | 请求体 |
| --- | --- | --- |
| `?action=mpu-create` | 创建分片会话 | 空；用 `X-File-Name` / `X-Folder` |
| `?action=mpu-upload&key=&uploadId=&partNumber=` | 上传一个分片 | 分片字节 |
| `?action=mpu-complete` | 完成 | `{ key, uploadId, parts: [{ partNumber, etag }] }` |
| `?action=mpu-abort` | 中止 | `{ key, uploadId }` |

### 文件夹

| 方法 | 路径 | 请求体 |
| --- | --- | --- |
| `GET` | `/api/folders` | — |
| `POST` | `/api/folders` | `{ name, parent }` |
| `PUT` | `/api/folders` | `{ oldName, newName }` |
| `DELETE` | `/api/folders` | `{ folder }` |
| `POST` | `/api/folders/share` | `{ folder }`，切换访客共享 |
| `POST` | `/api/folders/exclude` | `{ folder }`，切换从分享排除 |

### 分享

| 方法 | 路径 | 请求体 / 说明 |
| --- | --- | --- |
| `POST` | `/api/share` | `{ key, password?, expiresInDays? }` |
| `DELETE` | `/api/share/<key>` | 撤销该文件的分享 |
| `POST` | `/api/folder-share-link` | `{ folder, password?, expiresInDays? }` |
| `GET` | `/api/folder-share-link/<folder>` | 查询该文件夹的链接 |
| `DELETE` | `/api/folder-share-link/<folder>` | 撤销文件夹链接 |

创建单文件分享响应：

```json
{
  "token": "…",
  "expiresAt": "2026-12-28T00:00:00.000Z",
  "hasPassword": true,
  "downloads": 3
}
```

`expiresInDays` 为 `0` 或负数表示不过期；超过 3650 会被截到 3650。

### 统计与设置

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/api/stats` | 登录 |
| `GET` | `/api/settings` | 登录 |
| `PUT` | `/api/settings` | `admin` |

设置请求体：

```json
{
  "siteName": "My Vault",
  "siteIconUrl": "https://example.com/icon.png",
  "guestPageEnabled": true,
  "showLoginButton": false
}
```

### 账号

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/api/account` | 登录 |
| `PUT` | `/api/account/password` | 登录 |
| `GET` | `/api/users` | `admin` |
| `POST` | `/api/users` | `admin` |
| `PUT` | `/api/users/<uuid>` | `admin` |
| `DELETE` | `/api/users/<uuid>` | `admin` |

```json
// POST /api/users
{ "username": "alice", "password": "至少8位", "role": "user" }

// PUT /api/users/<uuid>
{ "username": "alice", "role": "admin", "password": "new-password" }

// PUT /api/account/password
{ "currentPassword": "old", "newPassword": "new" }
```

## 公开接口

这些接口不需要会话，但仍然受分享 token、密码 Cookie、文件夹公开标记约束。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/public/shared` | 访客首页的共享索引 |
| `GET` | `/api/public/folder?path=` | 公开文件夹内容 |
| `GET` | `/s/<token>` | 分享页 HTML |
| `POST` | `/s/<token>/verify` | 校验分享密码 |
| `GET` | `/s/<token>/download` | 下载 |
| `GET` | `/s/<token>/preview` | 预览 |

`/api/public/folder` 对 `/` 之外路径会检查祖先共享和排除标记；不在公开范围内的路径返回 404，而不是 403，避免泄露目录是否存在。

## 认证

网页登录：

```http
POST /auth/login
Content-Type: application/json

{ "username": "alice", "password": "…" }
```

成功写入 `session` Cookie。登录失败按 IP 限流，5 次 / 10 分钟。

初始化：

```http
POST /auth/setup
{ "username": "admin", "password": "…" }
```

只有在 KV 中还没有任何账号时可用。

退出：

```http
POST /auth/logout
```

## WebDAV

WebDAV 不走 `/api`。它使用 Basic Auth，入口是 `/dav/`。详见 [WebDAV](/features/webdav)。

## 示例

列出根目录：

```bash
curl -b cookies.txt "https://your-host/api/files?folder="
```

创建分享：

```bash
curl -b cookies.txt -X POST "https://your-host/api/share" \
  -H "Content-Type: application/json" \
  -d '{"key":"Projects/a.pdf","password":"secret","expiresInDays":7}'
```

访问公开分享：

```bash
curl "https://your-host/s/<token>/download"
```

## 错误码

| 状态 | 含义 |
| --- | --- |
| 400 | 请求体、文件名、路径不合法 |
| 401 | 未登录 / 会话失效 |
| 403 | 角色不够，或分享密码未通过 |
| 404 | 文件、文件夹、分享不存在 |
| 409 | 同名冲突、最后一个管理员保护 |
| 413 | ZIP 或上传超过限制 |
| 429 | 触发限流 |
| 500 | 未捕获异常或 R2 / KV 故障 |
