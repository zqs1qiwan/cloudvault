# CloudVault

A personal cloud storage platform built on **Cloudflare Workers + R2**. Zero server cost, globally distributed, with file sharing, folder management, and a clean admin dashboard.

[English](#features) | [中文](#功能特性)

---

## Features

- **File Management** — Upload, download, rename, move, delete, and organize files into folders
- **Folder System** — Create nested folders, drag-and-drop upload with folder structure
- **File Sharing** — Generate share links with optional password protection and expiration
- **Guest Page** — Public-facing page showing shared folders and files (toggle on/off)
- **Folder Sharing** — Share entire folders as guest-accessible, with inheritance to sub-folders
- **Share Exclusion** — Exclude specific sub-folders from inherited guest sharing
- **File Preview** — In-browser preview for images, videos, audio, PDFs, code, and Markdown
- **Image Lightbox** — Full-screen image gallery with keyboard navigation
- **Zip Download** — Select multiple files and download as a single zip archive
- **Search** — Search files across all folders with path display in results
- **Type Filtering** — Filter files by category (images, videos, audio, documents, code, etc.)
- **Dark/Light Mode** — Toggle between dark and light themes
- **Responsive** — Mobile-friendly sidebar and layout
- **Single Password Auth** — Simple admin password via Cloudflare secret

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible object storage) |
| Metadata | [Cloudflare KV](https://developers.cloudflare.com/kv/) (key-value store) |
| Frontend | Alpine.js + Tailwind CSS (CDN) |
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
│   │   └── download.ts       # Share link page & download handler
│   └── utils/
│       ├── types.ts          # TypeScript types & KV prefixes
│       └── response.ts       # JSON/error/redirect helpers
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

## License

[MIT](LICENSE)

---

# CloudVault

基于 **Cloudflare Workers + R2** 构建的个人云存储平台。零服务器成本，全球分布式部署，支持文件分享、文件夹管理和简洁的管理后台。

## 功能特性

- **文件管理** — 上传、下载、重命名、移动、删除，文件夹分类整理
- **文件夹系统** — 创建嵌套文件夹，拖拽上传保留文件夹结构
- **文件分享** — 生成分享链接，支持密码保护和过期时间设置
- **访客页面** — 公开展示已分享的文件夹和文件（可开关）
- **文件夹分享** — 将整个文件夹设为访客可访问，子文件夹自动继承
- **分享排除** — 从继承的访客分享中排除特定子文件夹
- **文件预览** — 浏览器内预览图片、视频、音频、PDF、代码和 Markdown
- **图片灯箱** — 全屏图片画廊，支持键盘导航
- **打包下载** — 选择多个文件打包成 zip 下载
- **文件搜索** — 跨文件夹搜索文件，结果显示文件路径
- **类型筛选** — 按类别筛选文件（图片、视频、音频、文档、代码等）
- **深色/浅色模式** — 主题切换
- **响应式设计** — 移动端适配
- **单密码认证** — 通过 Cloudflare Secret 配置管理员密码

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

## 许可证

[MIT](LICENSE)
