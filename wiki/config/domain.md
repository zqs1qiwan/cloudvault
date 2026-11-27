# 自定义域名

CloudVault 默认使用 `*.workers.dev` 地址。生产使用建议绑定自己的域名，原因很实际：

- 分享链接更短、更可信；
- WebDAV 客户端更容易接受正式证书；
- 可以给 `/admin` 单独加 Cloudflare Access；
- 以后更换 Worker 不需要改分享链接的域名。

## 前置条件

- 域名已经接入同一个 Cloudflare 账号；
- 域名的 DNS 由 Cloudflare 管理；
- Worker 已部署成功，`workers.dev` 地址可以打开。

## 在 Workers 控制台绑定

1. Cloudflare 控制台 → Workers & Pages；
2. 选择 CloudVault 的 Worker；
3. **Settings → Domains & Routes**；
4. 点击 **Add custom domain**；
5. 输入例如 `pan.example.com`；
6. Cloudflare 会创建对应的 DNS 记录并签发证书。

等待状态变成 Active 后，打开：

```text
https://pan.example.com/login
```

## 用 Wrangler 配置路由

也可以在 `wrangler.jsonc` 里声明：

```jsonc
{
  "routes": [
    {
      "pattern": "pan.example.com/*",
      "custom_domain": true
    }
  ]
}
```

然后重新部署：

```bash
npm run deploy
```

`custom_domain: true` 会让 Cloudflare 自动管理 DNS 和证书。不要和手动创建的 CNAME 重复。

## 证书与 HTTPS

Cloudflare 会为自定义域名签发边缘证书。确认：

- SSL/TLS 模式为 **Full** 或 **Full (strict)**；
- 不要用 Flexible，否则 Cloudflare 到源站可能是明文；
- 对 WebDAV 客户端，证书必须有效，否则 Windows / Finder 可能拒绝连接。

CloudVault 自己不处理 TLS，证书完全由 Cloudflare 负责。

## 路径规划

CloudVault 占用这些路径：

| 路径 | 用途 |
| --- | --- |
| `/` | 访客页或登录跳转 |
| `/login` `/setup` `/admin` | 页面 |
| `/api/*` | 私有 API |
| `/s/*` | 公开分享 |
| `/dav/*` | WebDAV |
| `/auth/*` | 登录 / 初始化 / 退出 |

不要把这些路径再分配给其他 Worker 或静态站点。一个域名建议只跑一个 CloudVault 实例。

## 更换域名

分享链接里包含域名。更换域名后：

- 旧域名的链接不会自动跳转到新域名；
- 如果旧域名仍然绑定在同一个 Worker，旧链接继续可用；
- 如果旧域名解绑，旧分享链接会失效。

需要长期稳定时，先保留旧域名一段时间，或只在新旧域名都指向同一个 Worker 的情况下切换。

## 常见问题

**域名显示 522 / 521？**

说明 DNS 或路由没有正确指向 Worker。检查 Domains & Routes 的状态，以及 DNS 记录是否被其他记录覆盖。

**WebDAV 客户端提示证书错误？**

确认域名证书已经 Active，客户端系统时间正确。Windows 对自签名和过期证书很严格。

**可以用 R2 的公开域名吗？**

不建议。CloudVault 的文件通过 Worker 鉴权读取；把 R2 桶直接公开会绕过分享和权限规则。自定义域名应绑定 Worker，不是 R2 公共访问。
