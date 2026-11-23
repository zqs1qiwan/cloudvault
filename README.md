# CloudVault

基于 **Cloudflare Workers + R2** 构建的个人云存储平台。零服务器成本、全球边缘分发、支持 WebDAV 挂载、文件分享和管理后台。

A personal cloud storage platform built on **Cloudflare Workers + R2**. Zero server cost, globally distributed, WebDAV mount support, file sharing, and a clean admin dashboard.

[中文文档](#中文) | [English](#english) | [Wiki 文档](https://github.com/zqs1qiwan/cloudvault/wiki)

---

<a id="中文"></a>

## 中文

### 功能亮点

**文件与文件夹管理**
- 上传、下载、重命名、移动、删除，支持拖拽上传
- 无限嵌套文件夹，侧边栏文件夹树可展开/折叠
- 多文件选择，批量打包 ZIP 下载
- 级联删除 — 删除文件夹时自动删除所有子文件和子文件夹

**文件分享**
- 生成分享链接，支持密码保护和过期时间
- 文件夹级分享 — 整个文件夹设为访客可见，子文件夹自动继承
- **分享排除** — 父文件夹已分享时，可单独关闭特定子文件夹的分享
- 分享链接支持 SEO 友好的简洁 URL（如 `/TVBOX/app.apk`）

**访客文件浏览器**
- 公开访客页面，支持浏览所有已分享的文件和文件夹
- 可排序列（名称/大小/日期）、文件类型图标、搜索功能
- 复制链接和下载按钮
- 深色/浅色模式、完整响应式布局

**WebDAV 支持（v1.5.0）**
- 在 `/dav/` 路径提供 WebDAV Class 1 端点
- **像 [alist](https://github.com/alist-org/alist) 一样使用** — 挂载为网络硬盘，同步系统备份
- 支持所有主流客户端：rclone、macOS Finder、Windows 资源管理器、Cyberduck
- 与 KV 元数据完全集成 — WebDAV 上传的文件在管理后台可见，反之亦然
- HTTP Basic Auth 认证（使用账号用户名 + 密码，与网页登录同一套凭据）
- 支持 9 种方法：PROPFIND、GET、HEAD、PUT、DELETE、MKCOL、MOVE、COPY、OPTIONS
- 浏览器直接访问 `/dav/` 显示带样式的目录列表

**CDN 边缘缓存（v1.3.1）**
- 公开下载通过 Cache API 缓存在 Cloudflare 全球 300+ 边缘节点
- 首次下载 `X-Cache: MISS`，后续下载 `X-Cache: HIT`，零 R2 成本
- 浏览器缓存 4 小时，边缘缓存 24 小时

**文件预览**
- 浏览器内预览：图片、视频、音频、PDF、代码、Markdown
- 图片灯箱 — 全屏画廊，键盘导航

**个性化**
- 自定义站点名称和 Logo 图标
- 深色/浅色模式切换
- Favicon 自动跟随自定义图标
- 隐藏管理入口 — 访客页面不暴露登录链接

### 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | [Cloudflare Workers](https://workers.cloudflare.com/) |
| 文件存储 | [Cloudflare R2](https://developers.cloudflare.com/r2/)（S3 兼容对象存储） |
| 元数据 | [Cloudflare KV](https://developers.cloudflare.com/kv/)（键值存储） |
| 前端 | Alpine.js + 构建期 Tailwind CSS |
| 协议 | WebDAV Class 1（RFC 4918） |
| 语言 | TypeScript（后端）、JavaScript（前端） |

### 快速开始

#### 环境要求

- [Node.js](https://nodejs.org/) >= 20.19
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) >= 4.0
- Cloudflare 账号

#### 1. 克隆仓库

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
```

#### 2. 创建 Cloudflare 资源

```bash
# 创建 R2 存储桶
wrangler r2 bucket create cloudvault-files

# 创建 KV 命名空间
wrangler kv namespace create VAULT_KV
```

#### 3. 配置 wrangler

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

编辑 `wrangler.jsonc`：
- 填入你的 `account_id`（在 Cloudflare 控制台中查找）
- 将 `kv_namespaces` 中的 `id` 替换为第 2 步创建的 KV 命名空间 ID

#### 4. 首次初始化（无需配置密钥）

本项目**不需要** `ADMIN_PASSWORD` 之类的部署密钥。部署完成后直接打开站点，会强制跳转到 `/setup`，在那里创建第一个管理员账号（用户名 + 密码，至少 8 位）；创建成功后该页面立即失效。

已有旧版本部署时，如果之前设置过 `ADMIN_PASSWORD`，首次访问会自动把它迁移成名为 `root` 的管理员账号，并标记为“需要修改密码”，不会把任何人锁在门外。

`SESSION_SECRET` 现在是**可选**的：分享链接的签名密钥会在首次使用时自动生成并存进 KV；只有你想自己掌管该密钥时才需要设置。

#### 5. 部署

```bash
npm run deploy
```

部署完成后访问 `https://cloudvault.<你的子域名>.workers.dev`，按提示完成首次初始化。

#### 本地开发

```bash
npm run dev
```

本地不需要 `.dev.vars`。若想让本地环境模拟“旧部署自动迁移”，可以临时写入：

```
ADMIN_PASSWORD=your-local-password
```

否则直接访问 `http://127.0.0.1:8787/setup` 走首次初始化流程。

### 账号与权限

- 登录：`/login`，用户名为账号名，不再固定为 `root`。
- 首次初始化：`/setup`，仅在没有账号时可访问。
- 账号管理（管理员）：`GET/POST /api/users`、`PUT/DELETE /api/users/{id}`，可新建、改名、改角色、重置密码、删除。
- 自助改密：`PUT /api/account/password`（需当前密码，成功后其它设备登出）。
- 角色：`admin` 可管理账号与站点设置；`user` 可使用文件、分享与 WebDAV。所有账号共用同一个文件库。
- WebDAV：Basic 认证使用同一套账号密码（例如 `admin` + 你的密码）。
- 安全约束：最后一个管理员不能被降级或删除；不能删除自己当前登录的账号；被重置密码或被删除的账号，其会话立即失效。

### 项目结构

```
cloudvault/
├── src/
│   ├── index.ts              # Worker 入口 & 路由
│   ├── auth.ts               # 认证（密码 + 会话）
│   ├── api/
│   │   ├── files.ts          # 文件 CRUD、上传、下载、打包、预览
│   │   ├── share.ts          # 分享链接、文件夹分享、访客访问
│   │   ├── settings.ts       # 站点设置
│   │   └── stats.ts          # 存储统计
│   ├── handlers/
│   │   ├── download.ts       # 分享链接页面 & 下载处理
│   │   └── webdav.ts         # WebDAV 协议处理（9 种方法）
│   └── utils/
│       ├── types.ts          # TypeScript 类型 & KV 前缀
│       ├── response.ts       # JSON/错误/重定向工具函数
│       └── webdav-xml.ts     # WebDAV XML 响应构建
├── public/
│   ├── dashboard.html        # 管理后台
│   ├── guest.html            # 访客页面
│   ├── login.html            # 登录页
│   ├── share.html            # 分享链接页
│   ├── js/                   # 前端 JavaScript
│   └── css/                  # 样式表
├── wrangler.jsonc            # Wrangler 配置（gitignored）
├── wrangler.example.jsonc    # 示例配置模板
├── package.json
├── tsconfig.json
└── LICENSE
```

### 版本历史

| 版本 | 亮点 |
|------|------|
| **v1.13.0** | 分片上传超时重试、失败/离页自动终止、未完成会话自动清理 |
| **v1.12.1** | 修复 Chrome 将保存的管理员用户名自动填入文件搜索框 |
| **v1.12.0** | 公共列表边缘缓存、搜索框自动填充修复、深色模式对比度提升 |
| **v1.11.0** | KV 快速首屏、手动 R2 同步、合并后台初始化、静态 Tailwind CSS |
| **v1.10.0** | R2/KV 自动对账、同名文件覆盖、下载与 Range 修复、安全和交互全面加固 |
| **v1.5.0** | WebDAV 支持、访客页面 UI 修复 |
| **v1.4.0** | 访客页面重设计为交互式文件浏览器 |
| **v1.3.x** | 简洁下载 URL、CDN 边缘缓存 |
| **v1.2.x** | 自定义品牌、Favicon、级联删除、暗色模式修复 |
| **v1.1.x** | 文件夹管理、分享排除、Alpine.js 响应式修复 |
| **v1.0.0** | 初始版本 — 文件上传/下载、文件夹、分享、访客页面 |

完整更新日志请查看 [Wiki — 更新日志](https://github.com/zqs1qiwan/cloudvault/wiki/Changelog)。

### 文档

详细使用说明请查看 **[Wiki 文档](https://github.com/zqs1qiwan/cloudvault/wiki)**：

- [安装指南](https://github.com/zqs1qiwan/cloudvault/wiki/Installation)
- [配置说明](https://github.com/zqs1qiwan/cloudvault/wiki/Configuration)
- [使用指南](https://github.com/zqs1qiwan/cloudvault/wiki/Usage-Guide)
- [WebDAV 指南](https://github.com/zqs1qiwan/cloudvault/wiki/WebDAV)
- [更新日志](https://github.com/zqs1qiwan/cloudvault/wiki/Changelog)
- [常见问题](https://github.com/zqs1qiwan/cloudvault/wiki/FAQ)

---

<a id="english"></a>

## English

### Feature Highlights

**File & Folder Management**
- Upload, download, rename, move, delete — with drag-and-drop support
- Unlimited nested folders with collapsible sidebar folder tree
- Multi-select files for batch ZIP download
- Cascade delete — deleting a folder removes all child files and sub-folders

**File Sharing**
- Generate share links with optional password protection and expiration
- Folder-level sharing — entire folder visible to guests, sub-folders inherit automatically
- **Share exclusion** — disable sharing on specific sub-folders even when parent is shared
- SEO-friendly clean download URLs (e.g., `/TVBOX/app.apk`)

**Guest File Browser**
- Public guest page showing all shared files and folders
- Sortable columns (name/size/date), file type icons, search
- Copy-link and download buttons
- Dark/light mode, fully responsive layout

**WebDAV Support (v1.5.0)**
- WebDAV Class 1 endpoint at `/dav/`
- **Works like [alist](https://github.com/alist-org/alist)** — mount as network drive, sync system backups
- All major clients supported: rclone, macOS Finder, Windows Explorer, Cyberduck
- Fully integrated with KV metadata — files uploaded via WebDAV appear in dashboard and vice versa
- HTTP Basic Auth (account username and password, the same credentials as the web login)
- 9 methods: PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, OPTIONS
- Browser-friendly styled directory listing at `/dav/`

**CDN Edge Caching (v1.3.1)**
- Public downloads cached at Cloudflare's 300+ edge locations via Cache API
- First download `X-Cache: MISS`, subsequent `X-Cache: HIT` — zero R2 cost
- Browser cache: 4 hours, edge cache: 24 hours

**File Preview**
- In-browser preview: images, videos, audio, PDFs, code, Markdown
- Image lightbox — full-screen gallery with keyboard navigation

**Customization**
- Custom site name and logo icon
- Dark/light mode toggle
- Favicon follows custom icon
- Hidden admin entry — no login link exposed on guest page

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible object storage) |
| Metadata | [Cloudflare KV](https://developers.cloudflare.com/kv/) (key-value store) |
| Frontend | Alpine.js + build-time Tailwind CSS |
| Protocol | WebDAV Class 1 (RFC 4918) |
| Language | TypeScript (backend), JavaScript (frontend) |

### Quick Start

#### Prerequisites

- [Node.js](https://nodejs.org/) >= 20.19
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) >= 4.0
- A Cloudflare account

#### 1. Clone the repository

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
```

#### 2. Create Cloudflare resources

```bash
# Create R2 bucket
wrangler r2 bucket create cloudvault-files

# Create KV namespace
wrangler kv namespace create VAULT_KV
```

#### 3. Configure wrangler

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Edit `wrangler.jsonc`:
- Set your `account_id` (find it in the Cloudflare dashboard)
- Set the `id` in `kv_namespaces` to the KV namespace ID from step 2

#### 4. First-run setup (no secrets needed)

There are no deployment secrets to configure. Open the deployed site: it redirects to `/setup`, where you create the first administrator account (username + password, 8+ characters). That page stops working as soon as the account exists.

Upgrading from an older version that still has `ADMIN_PASSWORD` set? It is converted into a `root` administrator on first page load and flagged "change this password", so nobody gets locked out.

`SESSION_SECRET` is now optional: the share-link signing key is generated on first use and stored in KV. Set it only if you want to own that key yourself.

#### 5. Deploy

```bash
npm run deploy
```

Your CloudVault instance is now live at `https://cloudvault.<your-subdomain>.workers.dev`; finish setup in the browser.

#### Local Development

```bash
npm run dev
```

`.dev.vars` is not required. Visit `http://127.0.0.1:8787/setup` to go through first-run setup. To simulate a legacy deployment instead, put `ADMIN_PASSWORD=something` in `.dev.vars`.

### Accounts and roles

- Sign in at `/login` with a username and password; the username is no longer hard-coded.
- `/setup` creates the first administrator and refuses to run once any account exists.
- Administration API: `GET/POST /api/users`, `PUT/DELETE /api/users/{id}` (create, rename, change role, reset password, delete).
- Self-service password change: `PUT /api/account/password` (requires the current password; other devices are signed out).
- Roles: `admin` manages accounts and site settings; `user` gets files, sharing and WebDAV. Every account shares one vault.
- WebDAV uses the same account credentials over Basic auth.
- Safeguards: the last administrator cannot be demoted or deleted, you cannot delete the account you are signed in with, and a reset or deleted account loses its sessions immediately.

### Project Structure

```
cloudvault/
├── src/
│   ├── index.ts              # Worker entry point & router
│   ├── auth.ts               # Login, first-run setup, sessions
│   ├── api/
│   │   ├── files.ts          # File CRUD, upload, download, zip, preview
│   │   ├── share.ts          # Share links, folder sharing, guest access
│   │   ├── users.ts          # Account management (admin only)
│   │   └── settings.ts       # Site settings
│   ├── handlers/
│   │   ├── download.ts       # Share link page & download handler
│   │   └── webdav.ts         # WebDAV protocol handler (class 1)
│   ├── lib/
│   │   ├── accounts.ts       # Account records, bootstrap, DAV credential cache
│   │   ├── passwords.ts      # PBKDF2 hashing shared by accounts and shares
│   │   ├── objects.ts        # R2 helpers (list, copy, delete)
│   │   ├── shares.ts         # Share records and folder flags
│   │   ├── snapshot.ts       # Folder tree & stats cache
│   │   ├── zip.ts            # Streaming ZIP writer
│   │   └── ...               # http, mime, paths, ratelimit, secret
│   └── utils/
│       ├── types.ts          # TypeScript types & KV prefixes
│       └── webdav-xml.ts     # WebDAV XML response builders
├── public/
│   ├── dashboard.html        # Admin dashboard
│   ├── guest.html            # Public guest page
│   ├── login.html            # Login page
│   ├── setup.html            # First-run setup (only before the first account)
│   ├── share.html            # Share link page
│   ├── js/                   # Frontend JavaScript
│   └── css/                  # Stylesheets
├── wrangler.jsonc            # Wrangler config (gitignored)
├── wrangler.example.jsonc    # Example config template
├── package.json
├── tsconfig.json
└── LICENSE
```

### Version History

| Version | Highlights |
|---------|-----------|
| **v1.13.0** | Multipart timeouts and retries, automatic abort on failure/navigation, stale upload cleanup |
| **v1.12.1** | Prevent Chrome from autofilling the saved admin username into file search |
| **v1.12.0** | Public listing edge cache, search autofill fix, improved dark-mode contrast |
| **v1.11.0** | Fast KV-backed startup, manual R2 sync, consolidated bootstrap, static Tailwind CSS |
| **v1.10.0** | R2/KV reconciliation, same-name overwrite, download and Range fixes, security and UI hardening |
| **v1.5.0** | WebDAV support, guest page UI fixes |
| **v1.4.0** | Guest page redesigned as interactive file browser |
| **v1.3.x** | Clean download URLs, CDN edge caching |
| **v1.2.x** | Custom branding, favicon, cascade delete, dark mode fixes |
| **v1.1.x** | Folder management, share exclusions, Alpine.js reactivity fixes |
| **v1.0.0** | Initial release — file upload/download, folders, sharing, guest page |

Full changelog at [Wiki — Changelog](https://github.com/zqs1qiwan/cloudvault/wiki/Changelog).

### Documentation

See the **[Wiki](https://github.com/zqs1qiwan/cloudvault/wiki)** for detailed guides:

- [Installation](https://github.com/zqs1qiwan/cloudvault/wiki/Installation)
- [Configuration](https://github.com/zqs1qiwan/cloudvault/wiki/Configuration)
- [Usage Guide](https://github.com/zqs1qiwan/cloudvault/wiki/Usage-Guide)
- [WebDAV Guide](https://github.com/zqs1qiwan/cloudvault/wiki/WebDAV)
- [Changelog](https://github.com/zqs1qiwan/cloudvault/wiki/Changelog)
- [FAQ](https://github.com/zqs1qiwan/cloudvault/wiki/FAQ)

---

## License / 许可证

[MIT](LICENSE)
