# 一键部署

CloudVault 在 README 顶部提供 **Deploy to Cloudflare** 按钮。这是给已经有 Cloudflare 账号的人准备的路径：不需要本地安装 Wrangler，也不需要先创建资源。

## 它会做什么

点击按钮后，Cloudflare 会：

1. 把 `zqs1qiwan/cloudvault` 克隆到你自己的 GitHub 账号；
2. 在你的 Cloudflare 账号里创建一个 R2 存储桶；
3. 创建一个 KV 命名空间；
4. 写入对应的绑定并部署 Worker；
5. 给你一个 `*.workers.dev` 地址，或允许你绑定自定义域名。

具体资源名和绑定以 Cloudflare 部署页面为准。CloudVault 的 `package.json` 里已经声明了两个绑定：

| 绑定 | 用途 |
| --- | --- |
| `VAULT_BUCKET` | R2 文件本体 |
| `VAULT_KV` | 账号、会话、分享记录、站点设置、限流计数 |

## 部署后的第一件事

打开部署完成的地址，应该会被引导到：

```text
https://<your-worker>.<subdomain>.workers.dev/setup
```

创建第一个管理员账号。用户名和密码规则见 [首次初始化](/guide/first-run)。

> `/setup` 只在“还没有任何账号”时可用。创建成功后，它会自动跳转到 `/login`。

## 需要确认的配置

一键部署通常会生成 `wrangler.jsonc`。如果你想改站点名、Logo、是否开放访客页，不需要改这个文件，登录后台的 **设置** 即可。

如果你要改资源名、绑定自定义域名或调整兼容日期，再编辑 `wrangler.jsonc`。字段说明见 [绑定与配置](/config/bindings)。

## 常见问题

**部署后打开是 500 或空白页？**

先检查 Worker 的实时日志，确认 R2 和 KV 绑定是否真的存在。一键部署创建资源失败时，Worker 已经上线但绑定可能为空。到 Cloudflare 控制台的 Workers → Settings → Bindings 检查。

**部署按钮要求我授权 GitHub，安全吗？**

Cloudflare 需要读取仓库并克隆到你的账号。它不会拿到你的 GitHub 密码；授权范围由 Cloudflare 的部署流程控制。你也可以走 [手动部署](/guide/manual-deploy)，完全不经过这个授权。

**可以部署到已有的 Worker 吗？**

可以，但需要自己保证资源绑定和路由正确。更推荐为 CloudVault 单独建一个 Worker，避免和别的项目共享同一个 R2 / KV。

**部署会覆盖我已有的数据吗？**

不会。部署只写 Worker 代码和绑定；R2 桶和 KV 命名空间里的数据不会被清空。但如果你把 `VAULT_BUCKET` 绑到一个已经有其他数据的桶，CloudVault 会把那里的对象当作自己的文件库，所以一定要使用独立资源。
