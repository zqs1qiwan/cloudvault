# 手动部署

手动部署适合想自己控制资源名、域名、账号和账单的人。整个过程只有三件事：创建 R2、创建 KV、部署 Worker。

## 环境要求

- Node.js **20.19+**
- Wrangler **4+**
- 已开通 R2 的 Cloudflare 账号
- 一个可以用 `wrangler login` 授权的终端

## 1. 克隆并安装

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
wrangler login
```

## 2. 创建 R2 存储桶

```bash
wrangler r2 bucket create cloudvault-files
```

桶名可以改，但要和后面的 `bucket_name` 一致。不要把已有业务数据的桶拿来复用。

## 3. 创建 KV 命名空间

```bash
wrangler kv namespace create VAULT_KV
```

命令会输出一个 `id`。把它填进 `wrangler.jsonc` 的 `kv_namespaces`。

## 4. 准备配置文件

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

至少检查这些字段：

```jsonc
{
  "name": "cloudvault",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-11",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  },
  "r2_buckets": [
    { "binding": "VAULT_BUCKET", "bucket_name": "cloudvault-files" }
  ],
  "kv_namespaces": [
    { "binding": "VAULT_KV", "id": "<your-kv-id>" }
  ]
}
```

`account_id` 可以显式填写，也可以依赖 `wrangler login` 的当前账号。完整字段见 [绑定与配置](/config/bindings)。

## 5. 构建 CSS 并部署

```bash
npm run build:css
npm run deploy
```

`predeploy` 会自动执行 `build:css`，所以直接 `npm run deploy` 通常也可以。第一次部署完成后，打开 Worker 地址，应该跳到 `/setup`。

> 不需要设置 `ADMIN_PASSWORD`。CloudVault 的第一个管理员由 `/setup` 创建；旧的 `ADMIN_PASSWORD` 只用于兼容升级，不是新部署的必需项。

## 6. 绑定自定义域名（可选）

在 Cloudflare 控制台的 Worker → Settings → Domains & Routes 里添加 Custom Domain。域名必须在同一个 Cloudflare 账号下，DNS 记录会自动创建。

更细的步骤见 [自定义域名](/config/domain)。

## 7. 验证

```bash
curl -I https://your-domain.example.com/login
curl -I https://your-domain.example.com/admin
```

- `/login` 应该返回 200；
- `/admin` 未登录时应该 302 到 `/login`；
- `/dav/` 未认证时应该返回 `401` 和 `WWW-Authenticate: Basic`。

## 更新部署

```bash
git pull
npm install
npm run check
npm run deploy
```

没有数据库迁移。升级只会换 Worker 代码；R2 对象和 KV 记录保留。升级前若做了较大的配置变更，先按 [备份与迁移](/config/backup) 留一份。

## 常见失败

| 现象 | 检查 |
| --- | --- |
| `Missing binding VAULT_BUCKET` | `wrangler.jsonc` 的 `r2_buckets` 名字和实际桶名是否一致 |
| `Missing binding VAULT_KV` | KV `id` 是否填错，是否属于当前账号 |
| 页面 404 | `assets.directory` 是否指向 `./public`，是否执行了 `build:css` |
| CSS 不生效 | 先 `npm run build:css`，再部署；`public/css/tailwind.css` 是构建产物 |
| `/setup` 一直跳 `/login` | KV 里已经存在账号，直接登录；忘记密码见 [故障排查](/help/troubleshooting) |
