# 本地开发

## 环境

- Node.js 22（当前项目在 v22.23.2 上验证）；
- npm 10；
- Cloudflare 账号（部署时需要，纯本地开发可不登录）；
- Wrangler 通过项目依赖安装，不需要全局安装。

## 拉取与安装

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
```

## 准备本地绑定

```bash
cp wrangler.example.jsonc wrangler.jsonc   # Windows: copy
```

首次本地运行，Wrangler 会在 `.wrangler/state` 里模拟 R2 和 KV。你可以直接用一个占位 ID 启动：

```jsonc
"kv_namespaces": [
  { "binding": "VAULT_KV", "id": "local-dev" }
]
```

本地模拟不校验真实 KV ID。要连真实资源时，先创建：

```bash
npx wrangler r2 bucket create cloudvault-files
npx wrangler kv namespace create VAULT_KV
```

把输出里的 `id` 填进 `wrangler.jsonc`。

## 启动

```bash
npm run dev
```

默认地址：

```text
http://localhost:8787
```

第一次打开会进入 `/setup`，创建本地管理员。数据保存在 `.wrangler/state`，删掉这个目录等于清空本地实例。

如果改了 Tailwind 源样式：

```bash
npm run build:css
```

`public/css/tailwind.css` 是构建产物；只改 HTML / TS 时不需要每次重建。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地 Worker |
| `npm run build:css` | 编译 Tailwind |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | Vitest |
| `npm run check` | 类型检查 + 测试 |
| `npm run types` | 根据绑定生成 Worker 类型 |
| `npm run deploy` | 构建 CSS 并部署 |
| `npm run tail` | 查看线上日志 |

## 本地数据

```text
.wrangler/state/    R2 + KV 的本地模拟数据
```

- 重置实例：停止 dev，删除 `.wrangler/state`；
- 保留演示数据：不要删这个目录；
- 不要把它提交到 git。

## 环境变量

本地可以建 `.dev.vars`：

```bash
SESSION_SECRET=local-only-secret
```

它不是必需的。没有设置时，CloudVault 会在 KV 里生成实例密钥。

## 调试分享

分享页不需要登录，但需要一条有效的分享记录：

1. 登录本地实例；
2. 上传一个文件；
3. 右键创建分享；
4. 用无痕窗口打开 `/s/<token>`。

分享密码 Cookie 的 `Secure` 属性在 `http://localhost` 下通常被浏览器放行；如果你用局域网 IP 的 HTTP 地址，Cookie 可能写不进去。

## 调试 WebDAV

```bash
curl -u alice:password -X PROPFIND \
  -H "Depth: 1" \
  http://localhost:8787/dav/
```

本地 HTTP 可以用 Basic Auth；线上必须 HTTPS。

## 常见问题

**端口被占用？**

```bash
npm run dev -- --port 8788
```

**修改绑定后类型不对？**

```bash
npm run types
npm run typecheck
```

**页面样式没更新？**

先确认改的是 `tailwind.css` 还是 `public/css/tailwind.css`。前者需要 `npm run build:css` 才会生成后者。

**本地 R2 数据在哪？**

`.wrangler/state`。这是 Miniflare 的本地模拟，不是真实 R2。
