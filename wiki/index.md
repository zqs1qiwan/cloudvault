---
layout: home

hero:
  name: CloudVault
  text: Build your own cloud.
  tagline: 基于 Cloudflare Workers + R2 的开源私有云盘。不用买服务器，不用维护数据库，把文件放在 Cloudflare 的边缘网络上。
  image:
    src: /brand/cloudvault-mark.svg
    alt: CloudVault
  actions:
    - theme: brand
      text: 5 分钟开始
      link: /guide/quick-start
    - theme: alt
      text: 手动部署
      link: /guide/manual-deploy
    - theme: alt
      text: GitHub
      link: https://github.com/zqs1qiwan/cloudvault

features:
  - icon: '01'
    title: 零服务器
    details: 一个 Worker、一个 R2 存储桶、一个 KV 命名空间。没有虚拟机、没有 SQL 数据库，也没有需要长期维护的文件索引。
  - icon: '02'
    title: 分享可控
    details: 单文件分享支持密码和有效期，文件夹可以开放给访客，也可以单独排除某个子目录。
  - icon: '03'
    title: WebDAV
    details: 用 rclone、Finder、资源管理器或 Cyberduck 把同一个文件库挂载成网络硬盘。
  - icon: '04'
    title: 双语双主题
    details: 中文 / English 一键切换，深色 / 浅色主题跟随你的阅读习惯。
  - icon: '05'
    title: 默认私有
    details: 单租户设计，没有公开注册入口。所有账号共享一个文件库，管理员决定谁能进来。
  - icon: '06'
    title: 一键部署
    details: 从 GitHub 直接 Deploy to Cloudflare，自动创建 R2 和 KV 资源，打开 /setup 就能使用。
---

<div class="home-wrap">

<div class="home-section">
  <div class="home-section-header">
    <h2>一个不需要运维的文件层</h2>
    <p>MIT 许可 · Cloudflare Workers + R2 · 单租户</p>
  </div>
  <p>CloudVault 不是一个缩小版的对象存储控制台，也不是要取代完整的协作套件。它只做一件很清楚的事：<strong>把文件安全地放在你自己的 Cloudflare 账号里，并给出可控的分享方式。</strong></p>
  <p>Worker 负责应用、登录、分享链接和 WebDAV；R2 存文件本体；KV 存账号、站点设置和签名密钥。文件对象本身就是文件 ID，所以没有第二份索引需要同步，也没有“索引和字节不一致”的状态。</p>
</div>

<div class="home-section">
  <div class="home-section-header">
    <h2>界面预览</h2>
    <p>来自真实实例的截图，不是概念稿</p>
  </div>
  <div class="home-shot-grid">
    <div class="home-shot is-wide">
      <img src="/screenshots/dashboard-zh.png" alt="CloudVault 后台：文件网格、文件夹树、上传与分享入口" loading="lazy">
      <div class="home-shot-body"><strong>文件管理</strong><span>文件网格、文件夹树、上传与分享入口。</span></div>
    </div>
    <div class="home-shot">
      <img src="/screenshots/guest-zh-crop.png" alt="未登录的公开分享页" loading="lazy">
      <div class="home-shot-body"><strong>公开分享页</strong><span>未登录即可浏览共享文件夹和公开文件。</span></div>
    </div>
    <div class="home-shot">
      <img src="/screenshots/share-dialog-zh-crop.png" alt="分享设置弹窗" loading="lazy">
      <div class="home-shot-body"><strong>分享设置</strong><span>为文件设置密码和有效期。</span></div>
    </div>
    <div class="home-shot is-wide">
      <img src="/screenshots/share-page-zh.png" alt="单文件公开分享页" loading="lazy">
      <div class="home-shot-body"><strong>单文件分享页</strong><span>图片预览、下载与分享链接。</span></div>
    </div>
  </div>
</div>

<div class="home-section">
  <div class="home-section-header">
    <h2>从零到可用</h2>
    <p>不用先读完整套文档</p>
  </div>
  <div class="home-quick">
    <div class="quick-card">
      <h3>一键部署</h3>
      <p>已有 Cloudflare 账号时，最快的方式是从仓库直接部署。Cloudflare 会创建 R2 存储桶和 KV 命名空间。</p>
      <pre><code>Deploy to Cloudflare
→ 打开 /setup
→ 创建第一个管理员</code></pre>
    </div>
    <div class="quick-card">
      <h3>本地跑起来</h3>
      <p>需要 Node.js 20.19+。本地开发使用 Wrangler 的本地 R2 / KV 模拟，不需要真实云端资源。</p>
      <pre><code>git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
npm run dev</code></pre>
      <p class="home-note">打开 http://127.0.0.1:8787/setup 完成初始化。</p>
    </div>
  </div>
</div>

<div class="home-section">
  <div class="home-section-header">
    <h2>文档地图</h2>
    <p>从部署到 API，按你需要的那一层开始</p>
  </div>
  <div class="docs-grid">
    <a class="docs-card" href="./guide/quick-start"><span class="num">GUIDE / 01</span><strong>快速开始</strong><span>部署、初始化、上传第一个文件。</span></a>
    <a class="docs-card" href="./guide/manual-deploy"><span class="num">GUIDE / 02</span><strong>手动部署</strong><span>自己创建 R2、KV 和 Worker。</span></a>
    <a class="docs-card" href="./features/sharing"><span class="num">FEATURE / 01</span><strong>分享链接</strong><span>密码、有效期、文件夹链接和访客规则。</span></a>
    <a class="docs-card" href="./features/webdav"><span class="num">FEATURE / 02</span><strong>WebDAV</strong><span>挂载到 Finder、Windows、rclone。</span></a>
    <a class="docs-card" href="./security/model"><span class="num">SECURITY / 01</span><strong>安全模型</strong><span>账号、会话、分享令牌和边界。</span></a>
    <a class="docs-card" href="./dev/api"><span class="num">DEV / 01</span><strong>HTTP API</strong><span>文件、文件夹、分享和账号接口。</span></a>
  </div>
</div>

<div class="home-cta">
  <div>
    <strong>Build your own.</strong>
    <span>不需要从一台服务器开始。把你的文件放进自己的 Cloudflare 账号。</span>
  </div>
  <a class="cta-link" href="https://github.com/zqs1qiwan/cloudvault" target="_blank" rel="noopener">查看 GitHub 仓库 →</a>
</div>

</div>
