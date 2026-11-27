import { defineConfig } from 'vitepress'

const base = process.env.DOCS_BASE || '/cloudvault/'

export default defineConfig({
  lang: 'zh-CN',
  title: 'CloudVault',
  titleTemplate: ':title · CloudVault 文档',
  description: '基于 Cloudflare Workers + R2 的开源私有云盘。从部署、使用到 WebDAV、安全和开发的完整文档。',
  base,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://zqs1qiwan.github.io',
    transformItems(items) {
      return items.map((item) => ({
        ...item,
        url: `${base}${item.url.replace(/^\//, '')}`,
      }))
    },
  },
  transformHtml(code) {
    if (base === '/') return code
    const prefix = base.replace(/\/$/, '')
    const bare = prefix.replace(/^\//, '')
    return code.replace(
      /\b(href|src)="\/(?!\/)([^"]*)"/g,
      (match, attr: string, path: string) => {
        if (path === bare || path.startsWith(`${bare}/`)) return match
        return `${attr}="${prefix}/${path}"`
      },
    )
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}brand/cloudvault-mark.svg` }],
    ['meta', { name: 'theme-color', content: '#F38020' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'CloudVault Docs' }],
    ['meta', { property: 'og:image', content: 'https://zqs1qiwan.github.io/cloudvault/social-preview.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: '/brand/cloudvault-mark.svg',
    siteTitle: 'CloudVault',
    nav: [
      { text: '指南', link: '/guide/', activeMatch: '/guide/' },
      { text: '功能', link: '/features/', activeMatch: '/features/' },
      { text: '配置', link: '/config/bindings', activeMatch: '/config/' },
      { text: '安全', link: '/security/model', activeMatch: '/security/' },
      { text: '开发', link: '/dev/architecture', activeMatch: '/dev/' },
      { text: 'v1.14.7', link: 'https://github.com/zqs1qiwan/cloudvault/releases/tag/v1.14.7' },
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: 'CloudVault 是什么', link: '/guide/' },
          { text: '快速开始', link: '/guide/quick-start' },
          { text: '一键部署', link: '/guide/deploy-button' },
          { text: '手动部署', link: '/guide/manual-deploy' },
          { text: '首次初始化', link: '/guide/first-run' },
          { text: '升级与回滚', link: '/guide/upgrade' },
        ],
      },
      {
        text: '核心功能',
        items: [
          { text: '功能总览', link: '/features/' },
          { text: '文件与文件夹', link: '/features/files' },
          { text: '上传与下载', link: '/features/upload-download' },
          { text: '在线预览', link: '/features/preview' },
          { text: '分享链接', link: '/features/sharing' },
          { text: '访客页面', link: '/features/guest' },
          { text: 'WebDAV', link: '/features/webdav' },
          { text: '成员与权限', link: '/features/users' },
          { text: '站点设置', link: '/features/settings' },
        ],
      },
      {
        text: '配置与运维',
        items: [
          { text: '绑定与配置', link: '/config/bindings' },
          { text: '自定义域名', link: '/config/domain' },
          { text: '容量与限制', link: '/config/limits' },
          { text: '备份与迁移', link: '/config/backup' },
          { text: '日志与监控', link: '/config/observability' },
        ],
      },
      {
        text: '安全',
        items: [
          { text: '安全模型', link: '/security/model' },
          { text: '加固清单', link: '/security/hardening' },
          { text: 'Cloudflare Access', link: '/security/access' },
        ],
      },
      {
        text: '开发',
        items: [
          { text: '架构', link: '/dev/architecture' },
          { text: 'HTTP API', link: '/dev/api' },
          { text: '本地开发', link: '/dev/local' },
          { text: '测试', link: '/dev/testing' },
          { text: '贡献指南', link: '/dev/contributing' },
        ],
      },
      {
        text: '帮助',
        items: [
          { text: '常见问题', link: '/help/faq' },
          { text: '故障排查', link: '/help/troubleshooting' },
          { text: '更新日志', link: '/help/changelog' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/zqs1qiwan/cloudvault' },
    ],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            displayDetails: '显示详细列表',
            resetButtonTitle: '清除查询',
            backButtonTitle: '关闭搜索',
            noResultsText: '没有找到结果',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },
    outline: {
      level: [2, 3],
      label: '本页目录',
    },
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
    lastUpdatedText: '最后更新',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色主题',
    darkModeSwitchTitle: '切换到深色主题',
    externalLinkIcon: true,
    editLink: {
      pattern: 'https://github.com/zqs1qiwan/cloudvault/edit/main/wiki/:path',
      text: '在 GitHub 上编辑此页',
    },
    footer: {
      message: 'CloudVault 是一个 MIT 许可的开源项目。',
      copyright: 'Build your own · <a href="https://github.com/zqs1qiwan/cloudvault" target="_blank" rel="noopener">zqs1qiwan/CloudVault</a>',
    },
  },
})
