# CloudVault

A personal cloud storage platform built on **Cloudflare Workers + R2**. Zero server cost, globally distributed, with file sharing, folder management, and a clean admin dashboard.

[English](#features) | [中文](#功能特性)

---

## Features

- **File Management** — Upload, download, rename, move, delete, and organize files into folders
- **Folder System** — Create nested folders, drag-and-drop upload with folder structure
- **File Sharing** — Generate share links with optional password protection and expiration
- **Guest File Browser** — Public-facing file browser with search, sortable columns (name/size/date), copy-link and download buttons, file type icons, dark/light mode, and responsive layout
- **Folder Sharing** — Share entire folders as guest-accessible, with inheritance to sub-folders
- **Share Exclusion** — Exclude specific sub-folders from inherited guest sharing
- **File Preview** — In-browser preview for images, videos, audio, PDFs, code, and Markdown
- **Image Lightbox** — Full-screen image gallery with keyboard navigation
- **Zip Download** — Select multiple files and download as a single zip archive
- **Search** — Search files across all folders with path display in results
- **Type Filtering** — Filter files by category (images, videos, audio, documents, code, etc.)
- **Dark/Light Mode** — Toggle between dark and light themes
- **Responsive** — Mobile-friendly sidebar and layout
- **Custom Branding** — Customize site name and logo icon via Settings
- **CDN Edge Caching** — Public downloads cached at Cloudflare's 300+ edge locations via Cache API, eliminating redundant R2 reads
- **Clean Download URLs** — SEO-friendly paths like `/TVBOX/app.apk` instead of opaque API endpoints
- **WebDAV Support** — Mount CloudVault as a network drive via WebDAV (like alist). Sync system backups, upload/download with any WebDAV client (rclone, Finder, Windows Explorer, Cyberduck)
- **Single Password Auth** — Simple admin password via Cloudflare secret

📖 **[Wiki Documentation / 文档](https://github.com/zqs1qiwan/cloudvault/wiki)** — Installation, configuration, usage guide, and FAQ in English and Chinese.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible object storage) |
| Metadata | [Cloudflare KV](https://developers.cloudflare.com/kv/) (key-value store) |
| Frontend | Alpine.js + Tailwind CSS (CDN) |
| Protocol | WebDAV (Class 1 — RFC 4918) |
| Language | TypeScript (backend), JavaScript (frontend) |

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) >= 4.0
- A Cloudflare account

### 1. Clone the repository

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
```

### 2. Create Cloudflare resources

```bash
# Create R2 bucket
wrangler r2 bucket create cloudvault-files

# Create KV namespace
wrangler kv namespace create VAULT_KV
```

### 3. Configure wrangler

Copy the example config and fill in your values:

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Edit `wrangler.jsonc`:
- Set your `account_id` (find it in the Cloudflare dashboard)
- Set the `id` in `kv_namespaces` to the KV namespace ID from step 2

### 4. Set secrets

```bash
# Admin login password
wrangler secret put ADMIN_PASSWORD

# Session encryption secret (use a random string)
wrangler secret put SESSION_SECRET
```

### 5. Deploy

```bash
npm run deploy
```

Your CloudVault instance is now live at `https://cloudvault.<your-subdomain>.workers.dev`.

### Local Development

```bash
npm run dev
```

Create a `.dev.vars` file for local secrets:

```
ADMIN_PASSWORD=your-local-password
SESSION_SECRET=your-local-secret
```

## Project Structure

```
cloudvault/
├── src/
│   ├── index.ts              # Worker entry point & router
│   ├── auth.ts               # Authentication (password + session)
│   ├── api/
│   │   ├── files.ts          # File CRUD, upload, download, zip, preview
│   │   ├── share.ts          # Share links, folder sharing, guest access
│   │   ├── settings.ts       # Site settings (guest page toggle)
│   │   └── stats.ts          # Storage statistics
│   ├── handlers/
│   │   ├── download.ts       # Share link page & download handler
│   │   └── webdav.ts         # WebDAV protocol handler (9 methods)
│   └── utils/
│       ├── types.ts          # TypeScript types & KV prefixes
│       ├── response.ts       # JSON/error/redirect helpers
│       └── webdav-xml.ts     # WebDAV XML response builders
├── public/
│   ├── dashboard.html        # Admin dashboard
│   ├── guest.html            # Public guest page
│   ├── login.html            # Login page
│   ├── share.html            # Share link page
│   ├── js/
│   │   ├── app.js            # Dashboard Alpine.js app
│   │   ├── upload.js         # Upload manager (chunked multipart)
│   │   └── share.js          # Share page logic
│   └── css/
│       └── app.css           # Custom styles
├── wrangler.jsonc            # Wrangler config (gitignored)
├── wrangler.example.jsonc    # Example config template
├── package.json
├── tsconfig.json
└── LICENSE
```

## CDN Edge Caching

Public file downloads are cached at Cloudflare's edge using the [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/). Worker-generated responses are **not** automatically cached by Cloudflare's CDN — CloudVault uses explicit `caches.default.match()` / `cache.put()` to store and serve responses at the edge.

| Request | Behavior |
|---------|----------|
| 1st download | `X-Cache: MISS` — fetches from R2, stores at edge |
| 2nd+ download | `X-Cache: HIT` + `cf-cache-status: HIT` — served from edge, zero R2 cost |

- **Browser cache**: 4 hours (`max-age=14400`)
- **Edge cache**: 24 hours (`s-maxage=86400`)
- **Custom domain required**: `*.workers.dev` does not support CDN caching

Cached endpoints:
- Clean URLs: `https://your-domain.com/FOLDER/filename.ext`
- Legacy API: `https://your-domain.com/api/public/download/{fileId}`

## WebDAV

CloudVault exposes a WebDAV endpoint at `/dav/` for mounting your storage as a network drive. This works like [alist](https://github.com/alist-org/alist) — you can sync system backups, firmware images, and any large files using standard WebDAV clients.

**Endpoint**: `https://your-domain.com/dav/`

**Authentication**: HTTP Basic Auth (username can be anything, password = your admin password)

### Client Setup

**rclone** (recommended for backup sync):

```bash
rclone config
# Type: webdav
# URL: https://your-domain.com/dav/
# Vendor: other
# User: admin
# Password: your-admin-password

# Sync a local folder
rclone sync /path/to/backups cloudvault:/backups/

# List files
rclone ls cloudvault:/
```

**macOS Finder**: Go → Connect to Server → `https://your-domain.com/dav/`

**Windows Explorer**: Map Network Drive → `https://your-domain.com/dav/`

**Cyberduck / Mountain Duck**: New Connection → WebDAV (HTTPS) → Server: `your-domain.com` → Path: `/dav/`

### Supported Methods

| Method | Description |
|--------|-------------|
| `PROPFIND` | List files and folders (Depth 0/1) |
| `GET` | Download files |
| `HEAD` | File/folder metadata |
| `PUT` | Upload / overwrite files |
| `DELETE` | Delete files or folders (recursive) |
| `MKCOL` | Create folders |
| `MOVE` | Move / rename files |
| `COPY` | Copy files |
| `OPTIONS` | Capability discovery (`DAV: 1`) |

### curl Examples

```bash
# List root directory
curl -u admin:password -X PROPFIND -H "Depth: 1" https://your-domain.com/dav/

# Create a folder
curl -u admin:password -X MKCOL https://your-domain.com/dav/backups/

# Upload a file
curl -u admin:password -X PUT -T backup.tar.gz https://your-domain.com/dav/backups/backup.tar.gz

# Download a file
curl -u admin:password https://your-domain.com/dav/backups/backup.tar.gz -o backup.tar.gz

# Delete a file
curl -u admin:password -X DELETE https://your-domain.com/dav/backups/backup.tar.gz
```

### Limits

- **Max upload size**: 100 MB per request (Cloudflare Workers body limit on paid plan)
- **Storage**: R2 has no storage limit; files uploaded via WebDAV appear in the dashboard and vice versa

## License

[MIT](LICENSE)

---

# CloudVault

基于 **Cloudflare Workers + R2** 构建的个人云存储平台。零服务器成本，全球分布式部署，支持文件分享、文件夹管理和简洁的管理后台。

## 功能特性

- **文件管理** — 上传、下载、重命名、移动、删除，文件夹分类整理
- **文件夹系统** — 创建嵌套文件夹，拖拽上传保留文件夹结构
- **文件分享** — 生成分享链接，支持密码保护和过期时间设置
- **访客文件浏览器** — 公开文件浏览器，支持搜索、可排序列（名称/大小/日期）、复制链接和下载按钮、文件类型图标、深色/浅色模式切换、响应式布局
- **文件夹分享** — 将整个文件夹设为访客可访问，子文件夹自动继承
- **分享排除** — 从继承的访客分享中排除特定子文件夹
- **文件预览** — 浏览器内预览图片、视频、音频、PDF、代码和 Markdown
- **图片灯箱** — 全屏图片画廊，支持键盘导航
- **打包下载** — 选择多个文件打包成 zip 下载
- **文件搜索** — 跨文件夹搜索文件，结果显示文件路径
- **类型筛选** — 按类别筛选文件（图片、视频、音频、文档、代码等）
- **深色/浅色模式** — 主题切换
- **响应式设计** — 移动端适配
- **自定义品牌** — 在设置中自定义站点名称和 Logo 图标
- **CDN 边缘缓存** — 公开下载通过 Cache API 缓存在 Cloudflare 全球 300+ 边缘节点，减少 R2 重复读取
- **简洁下载链接** — SEO 友好的路径如 `/TVBOX/app.apk`，替代不透明的 API 端点
- **WebDAV 支持** — 通过 WebDAV 将 CloudVault 挂载为网络硬盘（类似 alist）。同步系统备份、使用任意 WebDAV 客户端（rclone、Finder、Windows 资源管理器、Cyberduck）上传下载
- **单密码认证** — 通过 Cloudflare Secret 配置管理员密码

📖 **[Wiki 文档 / Documentation](https://github.com/zqs1qiwan/cloudvault/wiki)** — 安装指南、配置说明、使用指南和常见问题，支持中英双语。

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) >= 4.0
- Cloudflare 账号

### 1. 克隆仓库

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
```

### 2. 创建 Cloudflare 资源

```bash
# 创建 R2 存储桶
wrangler r2 bucket create cloudvault-files

# 创建 KV 命名空间
wrangler kv namespace create VAULT_KV
```

### 3. 配置 wrangler

复制示例配置并填入你的信息：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

编辑 `wrangler.jsonc`：
- 填入你的 `account_id`（在 Cloudflare 控制台中查找）
- 将 `kv_namespaces` 中的 `id` 替换为第 2 步创建的 KV 命名空间 ID

### 4. 设置密钥

```bash
# 管理员登录密码
wrangler secret put ADMIN_PASSWORD

# 会话加密密钥（使用随机字符串）
wrangler secret put SESSION_SECRET
```

### 5. 部署

```bash
npm run deploy
```

部署完成后访问 `https://cloudvault.<你的子域名>.workers.dev`。

### 本地开发

```bash
npm run dev
```

创建 `.dev.vars` 文件配置本地密钥：

```
ADMIN_PASSWORD=your-local-password
SESSION_SECRET=your-local-secret
```

## CDN 边缘缓存

公开文件下载通过 [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) 缓存在 Cloudflare 边缘节点。Worker 生成的响应**不会**被 Cloudflare CDN 自动缓存 — CloudVault 使用显式的 `caches.default.match()` / `cache.put()` 在边缘存储和提供响应。

| 请求 | 行为 |
|------|------|
| 首次下载 | `X-Cache: MISS` — 从 R2 获取，存储到边缘 |
| 后续下载 | `X-Cache: HIT` + `cf-cache-status: HIT` — 从边缘提供，零 R2 成本 |

- **浏览器缓存**：4 小时（`max-age=14400`）
- **边缘缓存**：24 小时（`s-maxage=86400`）
- **需要自定义域名**：`*.workers.dev` 不支持 CDN 缓存

缓存端点：
- 简洁链接：`https://your-domain.com/FOLDER/filename.ext`
- 旧版 API：`https://your-domain.com/api/public/download/{fileId}`

## WebDAV

CloudVault 在 `/dav/` 路径提供 WebDAV 端点，可将存储空间挂载为网络硬盘。功能类似 [alist](https://github.com/alist-org/alist) —— 你可以使用标准 WebDAV 客户端同步系统备份、固件镜像及各类大文件。

**端点地址**：`https://your-domain.com/dav/`

**认证方式**：HTTP Basic Auth（用户名任意，密码 = 管理员密码）

### 客户端配置

**rclone**（推荐用于备份同步）：

```bash
rclone config
# 类型: webdav
# URL: https://your-domain.com/dav/
# Vendor: other
# 用户名: admin
# 密码: 你的管理员密码

# 同步本地文件夹
rclone sync /path/to/backups cloudvault:/backups/

# 列出文件
rclone ls cloudvault:/
```

**macOS Finder**：前往 → 连接服务器 → `https://your-domain.com/dav/`

**Windows 资源管理器**：映射网络驱动器 → `https://your-domain.com/dav/`

**Cyberduck / Mountain Duck**：新建连接 → WebDAV (HTTPS) → 服务器：`your-domain.com` → 路径：`/dav/`

### 支持的方法

| 方法 | 说明 |
|------|------|
| `PROPFIND` | 列出文件和文件夹（Depth 0/1） |
| `GET` | 下载文件 |
| `HEAD` | 获取文件/文件夹元数据 |
| `PUT` | 上传/覆盖文件 |
| `DELETE` | 删除文件或文件夹（递归删除） |
| `MKCOL` | 创建文件夹 |
| `MOVE` | 移动/重命名文件 |
| `COPY` | 复制文件 |
| `OPTIONS` | 能力发现（`DAV: 1`） |

### 限制

- **单次上传上限**：100 MB（Cloudflare Workers 付费版请求体限制）
- **存储空间**：R2 无容量限制；通过 WebDAV 上传的文件会同步显示在管理后台，反之亦然

## 许可证

[MIT](LICENSE)
