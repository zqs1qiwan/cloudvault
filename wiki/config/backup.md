# 备份与迁移

CloudVault 没有内置的“导出全部数据”按钮。备份需要分别处理 **R2 文件** 和 **KV 控制面数据**。

## 备份什么

| 数据 | 位置 | 是否重要 |
| --- | --- | --- |
| 文件本体 | R2 `VAULT_BUCKET` | 必须 |
| 账号 | KV `user:*` / `userlookup:*` | 重要 |
| 分享 | KV `share:*` / `foldersharelink:*` | 重要 |
| 文件夹公开标记 | KV `foldershare:*` / `foldershare-exclude:*` | 重要 |
| 站点设置 | KV `settings:site` | 重要 |
| 会话 | KV `session:*` | 可不备，登录会重建 |
| 限流计数 | KV `rl:*` | 可不备 |

## 备份 R2

R2 提供 S3 兼容接口。推荐用 rclone 或任何支持 S3 的工具做一次全量同步。

1. 在 Cloudflare 控制台创建 R2 API Token；
2. 记录 Access Key ID、Secret Access Key、账号 ID 和桶名；
3. 在 rclone 里配置 S3 兼容端点；
4. 同步到本地或其他对象存储。

命令形态（以你的客户端为准）：

```bash
rclone copy cloudvault: ./backup/cloudvault-files --progress
```

注意：

- 不要把 R2 桶设为公开访问；
- 备份账号使用最小权限；
- 备份完成后检查文件数量和总大小；
- 大桶建议在低峰期做，避免和线上请求争用操作额度。

## 备份 KV

KV 里有账号、分享和设置。Cloudflare 控制台可以查看 KV，但批量导出需要用 Wrangler 或 API。

```bash
wrangler kv key list --namespace-id <your-kv-id>
wrangler kv key get --namespace-id <your-kv-id> "settings:site"
```

对每个需要保留的键执行 `get`，把结果写入本地文件。重点是：

```text
user:*
userlookup:*
share:*
foldershare:*
foldershare-exclude:*
foldersharelink:*
settings:site
settings:instance-secret
```

会话和限流计数可以不迁移。

> KV 是最终一致的。备份时尽量在低写入时段进行；如果备份期间有人新增账号或分享，可能漏掉最新几条记录。

## 迁移到另一个 Cloudflare 账号

1. 在新账号创建 R2 桶和 KV 命名空间；
2. 用 rclone 把对象复制到新桶；
3. 用 Wrangler / API 把 KV 记录写入新命名空间；
4. 在新账号部署 Worker，绑定新资源；
5. 绑定域名（如果域名也迁移）；
6. 验证登录、文件列表、分享链接和 WebDAV。

迁移后，旧实例的分享 token 仍然有效，因为 token 和记录一起迁过去了；但旧域名如果不再指向 Worker，旧链接会失效。

## 恢复

- **只丢 Worker**：重新部署即可，R2 / KV 不动。
- **只丢 KV**：恢复 KV 记录；否则账号、分享和设置会丢失，但文件仍在。
- **只丢 R2**：从备份恢复对象；KV 里指向已不存在对象的分享会变成“文件不存在”。
- **全丢**：先恢复 R2，再恢复 KV，最后部署 Worker。

恢复顺序很重要：先有文件，再有指向文件的分享记录；否则会出现一批“404 的分享”。

## 不建议的做法

- 直接删除 KV 命名空间来“重置”实例：会丢账号、分享、设置和签名密钥；
- 把生产桶和测试桶共用：两个实例会看到同一批文件；
- 把 R2 桶设为公开读：绕过 Worker 的鉴权和分享规则；
- 只备份文件、不备份 KV：文件还在，但账号和分享没了。
