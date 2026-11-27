# 快速开始

目标：从零部署一个可以登录、可以上传、可以分享的 CloudVault。整条路径大约 5 分钟。

## 你需要

- 一个 Cloudflare 账号，已开通 R2；
- 一个 GitHub 账号（一键部署会把仓库克隆到你的账号）；
- 浏览器。手动部署还需要 Node.js 20.19+ 和 Wrangler 4+。

> CloudVault 不需要 `ADMIN_PASSWORD` 之类的部署密钥。第一个管理员通过 `/setup` 创建。`SESSION_SECRET` 也是可选的，分享链接的签名密钥会在首次使用时自动生成并存入 KV。

## 路径 A：一键部署

1. 打开仓库的 [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/zqs1qiwan/cloudvault) 按钮。
2. 按 Cloudflare 的引导授权 GitHub，选择要创建的项目名。
3. Cloudflare 会自动创建 R2 存储桶和 KV 命名空间，并部署 Worker。
4. 部署完成后打开 Worker 地址，页面会跳转到 `/setup`。
5. 创建第一个管理员账号。账号创建成功后，`/setup` 会自动失效。

更细的说明见 [一键部署](/guide/deploy-button)。

## 路径 B：手动部署

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
```

创建资源：

```bash
npx wrangler r2 bucket create cloudvault-files
npx wrangler kv namespace create VAULT_KV
```

复制配置模板，填入账号 ID 和上一步返回的 KV 命名空间 ID：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

然后部署：

```bash
npm run deploy
```

打开 Workers 域名后会自动跳转到 `/setup`。完整步骤见 [手动部署](/guide/manual-deploy)。

## 第一次使用

1. 在 `/setup` 创建管理员。用户名 3–32 个字符，只允许字母、数字、点、短横线和下划线；密码至少 8 位。
2. 登录后进入 `/admin`。拖拽文件到窗口，或点击 **上传**。
3. 用 **新建文件夹** 建目录；右键文件或文件夹可以分享、重命名、移动、删除。
4. 在 **设置** 里打开 **启用访客页面**，共享的文件才会出现在未登录首页。
5. 在 **用户** 里添加普通成员。`admin` 可以管理站点设置和成员，`user` 可以管理文件、分享和 WebDAV。

## 验证部署

- `/login` 能打开并登录；
- `/admin` 能看到仪表盘；
- 上传一个小文件后，文件网格出现该文件；
- 创建一个分享链接，退出登录后仍能打开 `/s/<token>`；
- 如果启用了访客页面，未登录访问 `/` 能看到共享内容。

## 下一步

- [上传与下载](/features/upload-download)：大文件、多文件、ZIP。
- [分享链接](/features/sharing)：密码、有效期、文件夹链接。
- [WebDAV](/features/webdav)：把云盘挂到电脑上。
- [安全加固](/security/hardening)：上线前检查清单。
