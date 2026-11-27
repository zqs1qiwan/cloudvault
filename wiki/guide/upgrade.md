# 升级与回滚

CloudVault 的升级只替换 Worker 代码。文件在 R2，账号和分享记录在 KV，没有数据库迁移步骤。

## 升级前

- 看一次 [Releases](https://github.com/zqs1qiwan/cloudvault/releases) 的说明，确认没有破坏性变更；
- 如果做过自定义修改，先提交或备份你的分支；
- 重要实例先按 [备份与迁移](/config/backup) 留一份 R2 / KV 的副本；
- 在低峰期升级，避免正在上传的大文件被 Worker 重启打断。

## 自动部署

如果仓库连接了 Cloudflare Workers Builds，或者你的 GitHub Actions 会自动部署：

1. 合并或推送到 `main`；
2. 等构建完成；
3. 打开站点确认 `/login`、`/admin` 和一个分享链接正常。

CloudVault 的静态资源在 `public/`，Worker 在 `src/`。构建时需要先跑 `npm run build:css`，再部署；仓库的 `predeploy` 已经处理这一步。

## 手动升级

```bash
cd cloudvault
git pull
npm install
npm run check
npm run deploy
```

`npm run check` 会先做 TypeScript 检查，再跑测试。通过后再部署，能避免把编译错误带上线。

## 升级后检查

- `/login` 能正常打开；
- 管理员能登录；
- 文件列表能看到原有文件；
- 新建一个分享链接，退出登录后能打开；
- WebDAV 客户端还能用原来的账号密码连接；
- 访客页面（如果启用）显示正常。

## 回滚

优先使用 Cloudflare 控制台的部署历史：

1. Workers → 选择 CloudVault；
2. 打开 Deployments；
3. 找到上一个正常版本；
4. 使用 Rollback / Redeploy。

也可以在本地用 Wrangler 回滚到上一个版本：

```bash
wrangler deployments list
wrangler rollback
```

回滚只影响 Worker 代码，不会回滚 R2 文件或 KV 记录。如果你在升级后又上传或改过分享，这些数据会留在当前状态。

## 版本与数据

| 数据 | 位置 | 升级影响 |
| --- | --- | --- |
| 文件本体 | R2 `VAULT_BUCKET` | 不变 |
| 账号 | KV `user:*` / `userlookup:*` | 不变 |
| 会话 | KV `session:*` | 不变；TTL 7 天 |
| 分享 | KV `share:*` / `foldersharelink:*` | 不变 |
| 站点设置 | KV `settings:site` | 不变 |
| 版本号 | `package.json` / Release tag | 仅元数据 |

> 没有“迁移脚本”需要执行。也正因为如此，不要在升级时删除或重建 KV 命名空间；那会同时丢掉账号、分享和设置。
