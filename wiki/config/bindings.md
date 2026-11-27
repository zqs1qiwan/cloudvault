# 绑定与配置

CloudVault 的部署配置在 `wrangler.jsonc`。仓库提供了一份 `wrangler.example.jsonc`，复制后填入自己的资源。

## 最小配置

```jsonc
{
  "name": "cloudvault",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-11",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "not_found_handling": "none",
    "run_worker_first": ["/", "/admin", "/api/*", "/s/*", "/login", "/auth/*"]
  },
  "r2_buckets": [
    {
      "binding": "VAULT_BUCKET",
      "bucket_name": "cloudvault-files"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "VAULT_KV",
      "id": "<your-kv-namespace-id>"
    }
  ],
  "vars": {
    "ENVIRONMENT": "production"
  }
}
```

| 字段 | 作用 |
| --- | --- |
| `name` | Worker 名称 |
| `main` | Worker 入口 `src/index.ts` |
| `compatibility_date` | Workers 运行时兼容日期 |
| `compatibility_flags` | 当前需要 `nodejs_compat` |
| `assets.directory` | 静态页面与前端资源目录 `./public` |
| `assets.binding` | 静态资源绑定名 `ASSETS` |
| `assets.run_worker_first` | 这些路径先交给 Worker，而不是直接返回静态文件 |
| `r2_buckets` | 文件桶绑定 |
| `kv_namespaces` | 控制面 KV 绑定 |

`run_worker_first` 很关键：`/`、`/admin`、`/api/*`、`/s/*`、`/login`、`/auth/*` 需要 Worker 先做鉴权、品牌注入或分享校验。不要把这些路径交给静态资源层直接返回。

## 必需绑定

### `VAULT_BUCKET`

R2 桶，存所有文件对象。

- 建议单独建桶，不要和其他项目共用；
- 桶不需要公开访问；
- `bucket_name` 必须和实际桶名完全一致；
- 代码通过 Worker 读取，不生成 R2 公网 URL。

### `VAULT_KV`

KV 命名空间，存：

| 前缀 | 内容 |
| --- | --- |
| `user:` | 账号记录 |
| `userlookup:` | 用户名 → 账号 ID |
| `session:` | 登录会话，7 天 TTL |
| `share:` | 单文件分享记录 |
| `foldershare:` | 文件夹访客共享标记 |
| `foldershare-exclude:` | 文件夹排除标记 |
| `foldersharelink:` | 文件夹分享链接 |
| `settings:` | 站点设置、实例签名密钥 |
| `rl:` | 限流计数 |

KV 不是文件索引。不要试图把它当数据库存文件元数据；文件元数据每次都从 R2 对象读取。

### `ASSETS`

`public/` 下的页面和前端资源，由 Cloudflare 静态资源绑定提供：

```text
public/
  dashboard.html
  guest.html
  login.html
  setup.html
  share.html
  404.html
  css/
  js/
  brand/
```

## 可选配置

### `SESSION_SECRET`

可选的 HMAC 密钥，用于签名分享密码 Cookie。没有配置时，CloudVault 会在首次使用时生成一个随机密钥并存到 KV：

```text
settings:instance-secret
```

一般不需要手动设置。只有在你希望固定密钥、或从旧部署迁移时，才设置它。

### `ADMIN_PASSWORD`

这是旧版单密码部署的兼容变量。新部署不需要它。

如果 KV 里还没有任何账号，而环境里存在 `ADMIN_PASSWORD`，CloudVault 会在第一次访问时创建一个名为 `root` 的管理员，并标记“必须改密码”。这是一次性迁移路径。

### `ENVIRONMENT`

示例里设为 `production`，当前代码不做分支判断，主要用于标识部署环境。

## 资源命名建议

| 资源 | 建议 |
| --- | --- |
| Worker | `cloudvault` |
| R2 | `cloudvault-files` |
| KV | `cloudvault-kv` |

多个实例（例如测试 / 生产）必须使用不同的 R2 和 KV，不能共用同一个绑定，否则文件库和账号会混在一起。

## 修改绑定后

```bash
npm run types
npm run check
npm run deploy
```

`wrangler types` 会根据绑定生成类型。改完 `wrangler.jsonc` 后，先让类型和代码对齐，再部署。

## 不要把配置提交到公共仓库

`wrangler.jsonc` 可能包含账号 ID、KV ID、桶名。仓库的 `.gitignore` 已经把本地配置排除；提交前确认没有把真实 ID 或密钥带上去。
