# 架构

CloudVault 是一个单 Worker 应用：一个入口处理页面、API、分享、WebDAV 和静态资源。没有独立后端服务，没有数据库，也没有构建后的 SSR 进程。

## 组件

```text
Cloudflare Edge
├── Worker（src/index.ts）
│   ├── 页面路由        / /login /setup /admin
│   ├── 认证与会话      /auth/*
│   ├── 私有 API        /api/*
│   ├── 分享页          /s/*
│   ├── WebDAV          /dav/*
│   └── 静态资源        ASSETS（public/）
├── R2  VAULT_BUCKET    文件对象
└── KV  VAULT_KV        账号 / 会话 / 分享 / 设置 / 限流
```

### 入口层

`src/index.ts` 负责：

1. 解析 URL 和 method；
2. 健康检查、公开 API、分享页、WebDAV、认证路由的分发；
3. 需要登录的页面和 API 先取会话；
4. 未初始化时把请求送到 `/setup`；
5. 给 HTML 注入站点品牌（名称、图标、语言）；
6. 统一加安全响应头；
7. 未匹配的路径交给静态资源或 404。

### 领域模块

| 目录 | 职责 |
| --- | --- |
| `src/api/files.ts` | 文件列表、元数据、上传、下载、重命名、移动、删除、ZIP、统计 |
| `src/api/share.ts` | 单文件分享、文件夹公开标记、文件夹分享链接 |
| `src/api/users.ts` | 账号、角色、密码、会话撤销 |
| `src/api/settings.ts` | 站点设置 |
| `src/handlers/download.ts` | 分享页和公开路径的下载 / 预览 |
| `src/handlers/dav.ts` | WebDAV 方法实现 |
| `src/lib/r2.ts` | R2 对象读写、分片、复制、遍历 |
| `src/lib/kv.ts` | KV 键前缀和读写封装 |
| `src/lib/path.ts` | key / 文件夹路径规范化与校验 |
| `src/lib/crypto.ts` | PBKDF2、随机 token、HMAC |
| `src/lib/http.ts` | 响应头、JSON、错误、缓存 |
| `src/lib/rate-limit.ts` | 基于 KV 的限流 |

## 数据模型

### 文件

```text
R2 key = 文件 ID
```

没有单独的 `fileId`。列表、下载、分享、WebDAV 全部用同一个 key。这样不会出现“元数据说文件在 A，R2 实际在 B”的双写问题。

文件元数据来自 R2 对象本身：

- `key`
- `size`
- `etag`
- `uploaded`（对象上传时间）
- `httpMetadata.contentType`
- `customMetadata.uploadedAt`

### 文件夹

文件夹是 key 的前缀，不是记录。空文件夹用 `.cv-folder` 占位对象：

```text
Projects/.cv-folder
```

列表时过滤掉这个标记。删除文件夹时递归删除前缀下所有对象。

### 账号

```text
user:<uuid>          { id, username, role, passwordHash, mustChangePassword, createdAt }
userlookup:<lower>   -> uuid
session:<token>      { accountId, createdAt }，TTL 7 天
```

用户名查找用单独的小写索引，避免每次扫描所有账号。

### 分享

```text
share:<token>                  { key, passwordHash, expiresAt, downloads, createdAt }
foldershare:<folder>           "1"
foldershare-exclude:<folder>   "1"
foldersharelink:<token>        { folder, passwordHash, expiresAt, createdAt }
```

单文件分享以 token 为键；文件夹链接也以 token 为键，但记录里带 `folder`。

## 关键设计

### R2 是唯一真相源

没有“先写数据库、再写 R2”的事务。列表直接 `list()`，单文件直接 `head()`。代价是：

- 大目录列表依赖 R2 的分页；
- 统计需要扫描，因此有 30 秒快照；
- 重命名 / 移动是复制 + 删除，不是原子操作。

收益是：不会出现数据库和对象存储不一致，也不需要迁移脚本。

### 无状态 Worker

Worker 不持有内存状态。会话、限流、设置都在 KV。因此：

- 任意边缘节点都能处理请求；
- 重启不丢登录态；
- 但 KV 最终一致，限流和设置同步有延迟。

### 分享 token 与文件 key 解耦

分享记录里存 key。文件重命名 / 移动时批量改分享记录的 key，token 不变。这样外部链接不会因为整理目录而失效。

### 静态页面 + API

前端是普通 HTML / CSS / JS，不使用 SSR 框架。页面通过 `fetch` 调 `/api/*`。这让 Worker 的职责清晰：

- 页面只负责渲染；
- API 只负责数据和鉴权；
- 静态资源可以直接由 ASSETS 返回。

## 扩展点

- 新增 API：在 `src/index.ts` 的 `API_ROUTES` 注册，再在对应 `api/*.ts` 实现；
- 新增页面：放在 `public/`，必要时加入 `run_worker_first`；
- 新增存储能力：优先在 `src/lib/r2.ts` 封装，不要在 handler 里直接拼 R2 调用；
- 新增鉴权方式：在入口层统一取账号，不要把角色判断散落到每个 handler。

## 不引入的东西

- 数据库 / ORM；
- 队列 / 定时任务；
- 服务端图片转码；
- 多租户；
- 前端框架运行时。

这不是“不能做”，而是当前规模下每引入一层都会增加部署和排障成本。先把单 Worker 的边界守住。
