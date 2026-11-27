# 日志与监控

CloudVault 把运行日志交给 Cloudflare Workers 的 observability，不在应用里另建一套日志系统。

## 实时日志

本地或已登录 Wrangler 时：

```bash
wrangler tail
```

它会流式输出 Worker 的 `console.log` / `console.error`。CloudVault 在未捕获异常时会打印：

```text
Unhandled error: <message>
```

但不会把文件内容、密码或 Cookie 打到日志里。

## Cloudflare 控制台

Workers & Pages → CloudVault → **Logs** 可以查看：

- 请求量；
- 错误率；
- CPU 时间；
- 最近的 invocation 日志。

`wrangler.example.jsonc` 里已经开启：

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 1,
  "logs": {
    "enabled": true,
    "head_sampling_rate": 1,
    "invocation_logs": true
  }
}
```

`head_sampling_rate: 1` 表示采样全部请求。流量很大时可以降低采样率，避免日志成本过高。

## 关键指标

建议观察：

| 指标 | 在哪看 | 异常含义 |
| --- | --- | --- |
| 5xx 比例 | Workers 控制台 | 绑定错误、R2 故障、代码异常 |
| CPU 时间 | Workers 控制台 | 大目录统计、PBKDF2、ZIP 或复制操作过重 |
| R2 Class A / B | R2 控制台 | 列表、上传、复制、删除的频率 |
| KV 读写 | Cloudflare 控制台 | 登录、分享、设置读写异常 |
| 带宽 | R2 / 分析 | 大文件下载或公开分享被刷 |

CloudVault 没有 Prometheus / OpenTelemetry 端点。需要更细的指标时，可以在 Cloudflare 侧接 Logpush 或 Analytics，或在 fork 里加埋点。

## 错误排查顺序

1. 先看 `wrangler tail` 的最后一条异常；
2. 检查 R2 / KV 绑定是否存在；
3. 检查请求路径是否被 `run_worker_first` 覆盖；
4. 检查分享 token 是否过期；
5. 检查 Cloudflare Access 是否拦截了 API 或 WebDAV；
6. 再看浏览器控制台的网络请求。

## 不要记录的东西

- 密码、Cookie、Authorization 头；
- 完整文件内容；
- 分享 token（日志里出现 token 等于泄露访问入口）；
- 账号 ID 和 bucket 名的组合。

如果要在 fork 里加日志，先想清楚日志会被谁看到、保留多久。
