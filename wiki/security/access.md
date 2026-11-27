# Cloudflare Access

Cloudflare Access 可以在 CloudVault 前面再加一层身份验证。它适合“管理入口只对特定邮箱开放”，但不适合直接套在整个站点上，否则公开分享也会被挡住。

## 推荐策略

| 路径 | Access | 原因 |
| --- | --- | --- |
| `/admin` | 开启 | 管理界面 |
| `/api/*` | 开启 | 私有 API |
| `/login` `/setup` `/auth/*` | 按需 | 如果开启，登录前先过 Access |
| `/s/*` | 不开启 | 公开分享必须能直接打开 |
| `/<folder>/<file>` | 不开启 | 公开简洁地址 |
| `/` | 不开启 | 访客页 |
| `/dav/*` | 单独决策 | 见下文 |

> 顺序很重要：Access 在 Worker 之前执行。它不知道你的分享 token，所以不能用来保护 `/s/*`。

## 创建 Access 应用

1. Cloudflare 控制台 → **Zero Trust** → **Access** → **Applications**；
2. **Add application** → **Self-hosted**；
3. 域名填你的 CloudVault 域名；
4. 路径填：

```text
admin
api
```

也可以分别为 `/admin` 和 `/api/*` 建两个应用，方便不同策略。

5. 创建策略：

```text
Action: Allow
Include: Emails: you@example.com
```

6. 保存并测试：退出 CloudVault 后访问 `/admin`，应该先看到 Access 登录页。

## 会话时长

Access 的 session duration 建议：

- 个人使用：24 小时到 1 周；
- 多人管理：8–24 小时；
- 高敏感：每次访问都验证。

Access 的会话和 CloudVault 的 7 天会话是两层，互不替代。

## WebDAV 与 Access

这是最容易踩坑的地方。

WebDAV 客户端通常：

- 不支持浏览器跳转登录；
- 不支持 Access 的 OTP 页面；
- 只支持 Basic Auth 或自定义 header。

可选方案：

### 方案 A：放行 `/dav/*`

在 Access 应用里把 `/dav/*` 排除，让 WebDAV 直接走 CloudVault 的 Basic Auth。

- 优点：Finder、Windows、rclone 都能用；
- 风险：DAV 入口只靠账号密码和限流保护；
- 必须：强密码、HTTPS、必要时加 WAF 速率限制。

### 方案 B：service token

为自动化 / rclone 创建 Access Service Token，在客户端加 header：

```text
CF-Access-Client-Id: <client-id>
CF-Access-Client-Secret: <client-secret>
```

rclone 支持 `--header`：

```bash
rclone copy ./data cloudvault:Backup/ \
  --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  --header "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
```

Finder 和 Windows 资源管理器不方便加自定义 header，通常只能用方案 A 或换客户端。

### 方案 C：DAV 单独域名

把 `/dav/*` 放到另一个主机名（例如 `dav.example.com`），单独设 Access 策略或不设。这样网页和 DAV 的边界更清楚，但需要额外的域名和路由配置。

## 保护 `/setup`

如果实例还没有初始化，`/setup` 是唯一能创建首个管理员的地方。建议：

- 部署后尽快完成初始化；
- 初始化完成后确认 `/setup` 跳转到 `/login`；
- 如果需要长期保留初始化入口，给 `/setup` 加 Access 或 IP 限制。

## 常见问题

**开启了 Access，分享页也要求登录？**

说明 Access 应用覆盖了 `/s/*` 或整个域名。把路径策略改窄，只覆盖 `/admin` 和 `/api/*`。

**API 返回 302 到 Access 登录页？**

CloudFront / Access 拦截了 `fetch` 请求。前端会看到非 JSON 响应。检查 Access 路径是否包含 `/api/*`，以及浏览器是否已经通过 Access 登录。

**WebDAV 一直 401？**

Access 先返回了登录页，Basic Auth 没到 Worker。放行 `/dav/*` 或用 service token。

**Access 登录后 CloudVault 还是未登录？**

这是两层会话。Access 通过后，仍需要在 `/login` 输入 CloudVault 账号。
