<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/cloudvault-lockup-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="public/brand/cloudvault-lockup-light.svg">
  <img alt="CloudVault" src="public/brand/cloudvault-lockup-light.svg" width="720">
</picture>

# CloudVault

基于 Cloudflare R2 的私有云盘。上传、整理、分享文件，也能通过 WebDAV 挂载到电脑；界面支持中英双语。

[中文](README.zh-CN.md) · [English](README.md) · [使用文档](https://github.com/zqs1qiwan/cloudvault/wiki)

`v1.14.0` · `Cloudflare Workers + R2` · `MIT`

## 主要功能

- **文件与文件夹** —— 拖拽上传、多级文件夹、重命名、移动、删除、批量打包 ZIP 下载。
- **分享链接** —— 支持密码保护和有效期，公开地址简洁易读。
- **文件夹分享** —— 整个文件夹开放给访客，也可单独排除某个子文件夹。
- **访客页面** —— 可搜索、可排序的公开文件列表，带复制链接和下载按钮。
- **WebDAV** —— 用 rclone、Finder、资源管理器或 Cyberduck 挂载为网络硬盘。
- **在线预览** —— 图片、视频、音频、PDF、Markdown 和代码直接在浏览器中打开。
- **双主题、双语言** —— 深色 / 浅色模式，中文 / 英文一键切换。
- **品牌定制** —— 在后台修改站点名称、Logo 和站点图标。

## 部署

**环境要求：** Node.js 20.19+、Wrangler 4+、已开通 R2 的 Cloudflare 账号。

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
```

创建两个 Cloudflare 资源：

```bash
wrangler r2 bucket create cloudvault-files
wrangler kv namespace create VAULT_KV
```

复制配置模板，填入账号 ID 和上一步输出的 KV 命名空间 ID：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

部署：

```bash
npm run deploy
```

打开 Workers 域名后会自动跳转到 `/setup`，创建第一个管理员账号即可。账号创建成功后，该页面会自动失效。

不需要 `ADMIN_PASSWORD` 之类的部署密钥。`SESSION_SECRET` 也是可选的：分享链接的签名密钥会在首次使用时自动生成并存入 KV。

## 使用方法

- 在 `/login` 登录，后台地址是 `/admin`。
- 拖拽文件到窗口即可上传，也可以点击 **Upload**；用 **New Folder** 新建文件夹。
- 右键文件或文件夹，可以分享、重命名、移动或删除。
- 在设置中开启 **Enable Guest Page**，共享文件就会出现在首页。
- 分享链接形如 `/s/<token>`，也支持 `/TVBOX/app.apk` 这样的简洁地址。
- WebDAV 地址为 `/dav/`，账号密码与网页登录相同。

点击页头右上角的 **EN / 中文** 即可切换语言，选择会保存在当前设备。

## 配置

站点名称、Logo 地址、访客页面和登录按钮都在后台的 **Settings** 中管理。

账号在 **Users** 中管理：

- `admin` —— 文件、分享、WebDAV、站点设置和账号管理。
- `user` —— 文件、分享和 WebDAV。

所有账号共用一个文件库。最后一个管理员不能被降级或删除。

## 本地开发

```bash
npm run dev
```

打开 `http://127.0.0.1:8787/setup` 完成首次初始化。不需要 `.dev.vars` 文件。

## 相关链接

- [使用文档](https://github.com/zqs1qiwan/cloudvault/wiki)
- [安装指南](https://github.com/zqs1qiwan/cloudvault/wiki/Installation)
- [WebDAV 指南](https://github.com/zqs1qiwan/cloudvault/wiki/WebDAV)
- [常见问题](https://github.com/zqs1qiwan/cloudvault/wiki/FAQ)
- [更新日志](https://github.com/zqs1qiwan/cloudvault/wiki/Changelog)

本项目采用 [MIT 许可证](LICENSE)。
