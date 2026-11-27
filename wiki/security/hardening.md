# 安全加固

按顺序做一遍，不需要一次全部启用。

## 1. 传输与域名

- [ ] 使用自定义域名，不用 `*.workers.dev` 作为长期入口；
- [ ] SSL/TLS 模式为 Full 或 Full (strict)；
- [ ] 确认 `http://` 会跳转到 `https://`；
- [ ] WebDAV 客户端信任证书。

## 2. 存储

- [ ] R2 桶没有开启公共访问；
- [ ] R2 API Token 使用最小权限，不用的 token 删除；
- [ ] 生产 / 测试使用不同的桶和 KV；
- [ ] 定期做一次 R2 备份。

## 3. 账号

- [ ] 第一个管理员使用强密码，不使用 `admin` / `password`；
- [ ] 只给确实需要管理站点的人 `admin`；
- [ ] 普通成员用 `user`，并知道他们能读写全部文件；
- [ ] 离职或不再需要的人及时删除；
- [ ] 定期检查 `mustChangePassword` 的账号。

## 4. 公开面

- [ ] 不需要公开首页时，关闭 **启用访客页面**；
- [ ] 需要公开时，只共享必要的文件夹，敏感子目录设为排除；
- [ ] 定期从无痕窗口检查 `/`；
- [ ] 分享链接尽量设有效期；
- [ ] 不把整个网盘结构共享给外部；
- [ ] 分享密码不要和账号密码相同。

## 5. 管理入口

- [ ] 对 `/admin` 和 `/api/*` 加 Cloudflare Access（见 [Cloudflare Access](/security/access)）；
- [ ] 或者在 Cloudflare WAF 对登录 / 初始化路径加额外速率限制；
- [ ] 不需要时关闭 `workers.dev` 路由；
- [ ] 不要把 `/admin` 暴露在无鉴权的反向代理后面。

## 6. WebDAV

- [ ] 只通过 HTTPS；
- [ ] 使用独立、强密码的账号；
- [ ] 不需要时不要在公网开放 `/dav/*`；
- [ ] 如果前面有 Access，为 DAV 客户端配置 service token，或单独放行 `/dav/*`。

## 7. 依赖与代码

- [ ] 定期 `npm audit` / Dependabot；
- [ ] 升级前跑 `npm run check`；
- [ ] 不把 `.dev.vars`、`wrangler.jsonc` 的真实 ID、R2 Token 提交到仓库；
- [ ] 审阅 fork 里新增的日志，避免打印密码 / Cookie / token。

## 8. 监控与恢复

- [ ] 开启 Workers Logs，观察 5xx；
- [ ] 给 R2 / KV 用量设提醒；
- [ ] 至少验证一次“从备份恢复”；
- [ ] 记录谁知道管理员密码、谁有 Cloudflare 账号权限。

## 9. 事故响应

如果怀疑泄露：

1. 撤销相关分享链接；
2. 重置管理员密码，撤销所有会话；
3. 轮换 R2 API Token 和 Cloudflare API Token；
4. 检查 Workers 日志和 R2 操作记录；
5. 如果文件内容泄露，考虑通知受影响的人；
6. 修复入口后再恢复公开访问。

## 不要做的事

- 不要把 R2 桶设为公开读来“让分享更快”；
- 不要用 `ADMIN_PASSWORD` 作为长期方案；
- 不要在 URL 参数里传密码；
- 不要把分享 token 贴到公开 issue；
- 不要给不信任的人 `admin` 或 `user`；
- 不要删除 KV 命名空间来“清空测试数据”，账号和分享会一起没。
