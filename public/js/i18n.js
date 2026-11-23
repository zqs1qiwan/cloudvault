/* CloudVault UI language layer.
   English stays the source language in the markup; this file swaps the
   visible strings to Chinese when the selected language is zh. */
(function () {
  'use strict';

  var STORAGE_KEY = 'cloudvault-lang';
  var SUPPORTED = ['en', 'zh'];

  var ZH = {
    "404 — Page Not Found": "404 — 页面未找到",
    "Page not found": "页面未找到",
    "Back to Home": "返回首页",
    "The page you're looking for doesn't exist or has been moved.": "页面不存在或已被移动。",
    "Powered by": "技术支持",

    "Home": "首页",
    "Root": "根目录",
    "Folder": "文件夹",
    "Name": "名称",
    "Size": "大小",
    "Modified": "修改时间",
    "Added": "添加时间",
    "Type": "类型",
    "Status": "状态",
    "Storage": "存储",
    "Upload": "上传",
    "Download": "下载",
    "Uploading": "上传中",
    "Search files": "搜索文件",
    "Search files...": "搜索文件…",
    "New Folder": "新建文件夹",
    "New folder": "新建文件夹",
    "Share": "分享",
    "Share File": "分享文件",
    "Share Folder Link": "分享文件夹链接",
    "Share Link": "分享链接",
    "Create Link": "创建链接",
    "Copy": "复制",
    "Copy link": "复制链接",
    "Copy download link": "复制下载链接",
    "Download file": "下载文件",
    "Delete": "删除",
    "Delete Files": "删除文件",
    "Delete Folder": "删除文件夹",
    "Move": "移动",
    "Move to...": "移动到…",
    "Rename": "重命名",
    "Rename File": "重命名文件",
    "Rename Folder": "重命名文件夹",
    "Preview": "预览",
    "Load more": "加载更多",
    "Loading…": "加载中…",
    "Cancel": "取消",
    "Close": "关闭",
    "Save": "保存",
    "Create": "创建",
    "Update": "更新",
    "Reset": "重置",
    "Clear done": "清除已完成",
    "No files yet": "暂无文件",
    "No accounts loaded.": "暂无账号。",
    "No shared files": "暂无共享文件",
    "Nothing has been shared publicly yet.": "还没有公开共享的文件。",
    "This folder is empty": "此文件夹为空",
    "Drop files here or click Upload to get started": "拖拽文件到此处，或点击“上传”开始",
    "Drop files to upload": "松开即可上传",
    "to Home": "到首页",

    "Site Settings": "站点设置",
    "Site Name": "站点名称",
    "Displayed in header, titles, and public pages": "显示在页头、标题和公开页面",
    "Icon URL": "图标地址",
    "Custom logo image URL (leave empty for default cloud icon)": "自定义 Logo 图片地址（留空使用默认云图标）",
    "Enable Guest Page": "启用访客页面",
    "Show public shared files at the home page": "在首页显示公开共享文件",
    "Show Login Button": "显示登录按钮",
    "Display \"Admin\" button on guest page": "在访客页显示“管理员”按钮",
    "Folder name": "文件夹名称",
    "Expires in (days)": "有效期（天）",
    "0 = never": "0 = 永不",
    "Password (optional)": "密码（可选）",
    "Leave empty for no password": "留空表示无密码",
    "Import changes made directly in R2": "同步在 R2 中直接做的修改",
    "Help & Documentation": "帮助与文档",
    "Toggle theme": "切换主题",
    "Toggle view": "切换视图",
    "Settings": "设置",
    "Users": "用户",
    "Account": "账号",
    "Logout": "退出登录",
    "Files and total size in this vault": "此云盘的文件数量与总大小",
    "Filter by file type": "按文件类型筛选",
    "Upload files": "上传文件",
    "Current password": "当前密码",
    "New password (8+)": "新密码（至少 8 位）",
    "Repeat new password": "再次输入新密码",
    "Set a new password": "设置新密码",
    "Change password": "修改密码",
    "Reset password": "重置密码",
    "Set a new password for this account": "请为此账号设置新密码",
    "This account still uses the password from the old deployment secret.": "此账号仍在使用旧部署密钥中的密码。",
    "Other devices are signed out; this one stays signed in.": "其他设备将退出登录，当前设备保持登录。",
    "Their active sessions are signed out; they will be asked to set a new password after signing in.": "其活动会话将退出；重新登录后需设置新密码。",
    "Add user": "添加用户",
    "All accounts share this vault. Administrators can manage settings and people.": "所有账号共享此云盘。管理员可管理设置与成员。",
    "All files and sub-folders inside will be permanently deleted.": "其中的所有文件和子文件夹将被永久删除。",
    "Include in Share": "加入分享",
    "Exclude from Share": "从分享中排除",
    "Share (Guest)": "分享（访客）",
    "Unshare (Guest)": "取消分享（访客）",
    "Revoke Link": "撤销链接",
    "🔒 Password protected": "🔒 密码保护",
    "🔗 link": "🔗 链接",
    "Shared Folder": "共享文件夹",
    "Excluded from share": "已从分享排除",
    "Guest shared": "访客可见",
    "Inherited share": "继承分享",
    "admin": "管理员",
    "user": "用户",
    "Admin": "管理员",

    "Password Protected": "密码保护",
    "Enter the password to access this file": "输入密码以访问此文件",
    "Unlock": "解锁",
    "File Not Available": "文件不可用",
    "This share link may have expired or been revoked.": "此分享链接可能已过期或被撤销。",
    "Link copied to clipboard": "链接已复制",
    "Shared Files": "共享文件",
    "No files match “": "没有匹配的文件 “",

    "Personal Cloud Storage": "个人云存储",
    "Sign In": "登录",
    "Sign in": "登录",
    "Username": "用户名",
    "Password": "密码",
    "Enter your password": "输入密码",
    "Upgrading an older single-password vault? Sign in as": "从旧版单密码云盘升级？请使用",
    "with the password you used before.": "以及之前使用的密码登录。",
    "First-time setup": "首次设置",
    "Create account": "创建账号",
    "Create the administrator account. This page stops working as soon as one account exists.": "创建管理员账号。账号一旦存在，此页面将自动停用。",
    "Confirm password": "确认密码",
    "Already set up?": "已完成设置？",
    "3-32 characters: letters, digits, dot, dash, underscore": "3–32 个字符：字母、数字、点、短横线、下划线",
    "At least 8 characters": "至少 8 个字符",
    "Repeat the password": "再次输入密码",
    "username": "用户名",
    "password (8+)": "密码（至少 8 位）",

    "CloudVault — Login": "CloudVault — 登录",
    "CloudVault — Setup": "CloudVault — 初始化",
    "CloudVault — Shared File": "CloudVault — 共享文件",
    "CloudVault — Shared Files": "CloudVault — 共享文件",

    "Invalid username or password": "用户名或密码错误",
    "Username and password required": "请输入用户名和密码",
    "This vault has not been set up yet.": "此云盘尚未初始化。",
    "This vault is already initialized. Sign in instead.": "此云盘已经初始化，请登录。",
    "That username is already taken": "该用户名已被占用",
    "Username may only contain letters, digits, dot, dash and underscore": "用户名只能包含字母、数字、点、短横线和下划线",
    "Username must be 3-32 characters": "用户名长度必须为 3–32 个字符",
    "Password must be at least 8 characters": "密码至少需要 8 个字符",
    "Password must be at most 128 characters": "密码最多 128 个字符",
    "Passwords do not match": "两次输入的密码不一致",
    "Setup failed": "初始化失败",
    "Signing in...": "登录中…",
    "Creating...": "创建中…",
    "Connection error. Please try again.": "连接失败，请重试。",
    "Connection error": "连接失败",
    "Incorrect password": "密码错误",
    "Too many attempts": "尝试次数过多",
    "Session expired": "会话已过期",
    "Upload failed": "上传失败",
    "Network error": "网络错误",
    "Upload timed out": "上传超时",
    "Preview not available for this file type": "此文件类型不支持预览",

    "Password updated": "密码已更新",
    "User created": "用户已创建",
    "Role updated": "角色已更新",
    "Password reset": "密码已重置",
    "User deleted": "用户已删除",
    "Folder shared": "文件夹已分享",
    "Folder unshared": "文件夹已取消分享",
    "Failed to toggle folder sharing": "切换文件夹分享状态失败",
    "Folder excluded from share": "文件夹已从分享中排除",
    "Folder included in share": "文件夹已加入分享",
    "Failed to toggle folder exclusion": "切换文件夹排除状态失败",
    "Folder renamed": "文件夹已重命名",
    "Rename failed": "重命名失败",
    "Delete failed": "删除失败",
    "Move failed": "移动失败",
    "Failed to load dashboard": "加载仪表盘失败",
    "Failed to synchronize R2": "同步 R2 失败",
    "Failed to load files": "加载文件失败",
    "Failed to delete files": "删除文件失败",
    "File renamed": "文件已重命名",
    "Folder created": "文件夹已创建",
    "Failed to create folder": "创建文件夹失败",
    "Share link created": "分享链接已创建",
    "Failed to create share link": "创建分享链接失败",
    "Share link revoked": "分享链接已撤销",
    "Failed to revoke link": "撤销链接失败",
    "Folder share link created": "文件夹分享链接已创建",
    "Failed to create folder share link": "创建文件夹分享链接失败",
    "Folder share link revoked": "文件夹分享链接已撤销",
    "Failed to revoke folder share link": "撤销文件夹分享链接失败",
    "Failed to download zip": "下载 ZIP 失败",
    "Zip downloaded": "ZIP 已下载",
    "Settings saved": "设置已保存",
    "Failed to save settings": "保存设置失败",
    "Folder deleted": "文件夹已删除",
    "Just now": "刚刚",

    "All Types": "全部类型",
    "Images": "图片",
    "Videos": "视频",
    "Audio": "音频",
    "Documents": "文档",
    "Archives": "压缩包",
    "Code": "代码",
    "Other": "其他",
    "Sync R2": "同步 R2",
    "Syncing": "同步中",
    "Selected": "已选择"
  };

  var RULES = [
    [/^(\d+) files · (\d+) folders$/, '$1 个文件 · $2 个文件夹'],
    [/^(\d+) file · (\d+) folder$/, '$1 个文件 · $2 个文件夹'],
    [/^(\d+) files · (.+)$/, '$1 个文件 · $2'],
    [/^(\d+) file · (.+)$/, '$1 个文件 · $2'],
    [/^(\d+) files$/, '$1 个文件'],
    [/^(\d+) file$/, '$1 个文件'],
    [/^(\d+) file\(s\) moved$/, '已移动 $1 个文件'],
    [/^(\d+) files synchronized$/, '已同步 $1 个文件'],
    [/^(\d+) file\(s\) deleted$/, '已删除 $1 个文件'],
    [/^(.+) uploaded$/, '$1 已上传'],
    [/^Failed to upload (.+)$/, '$1 上传失败'],
    [/^(.+) used$/, '$1 已用'],
    [/^(\d+) selected$/, '已选择 $1 项'],
    [/^(\d+) dl$/, '$1 次下载'],
    [/^(\d+) downloads$/, '$1 次下载'],
    [/^Signed in as (.+) \((.+)\)$/, '已登录：$1（$2）'],
    [/^Signed in as (.+)$/, '已登录：$1'],
    [/^Account: (.+)$/, '账号：$1'],
    [/^Current: (.+)$/, '当前：$1'],
    [/^Delete folder: (.+)$/, '删除文件夹：$1'],
    [/^Moving (\d+) file\(s\)$/, '正在移动 $1 个文件'],
    [/^Are you sure you want to delete (\d+) file\(s\)? This cannot be undone\.$/, '确定删除 $1 个文件？此操作无法撤销。'],
    [/^Expires: (.+)$/, '到期：$1'],
    [/^Uploading (\d+) \/ (\d+)$/, '正在上传 $1 / $2'],
    [/^to (.+)$/, '到 $1'],
    [/^(\d+)m ago$/, '$1 分钟前'],
    [/^(\d+)h ago$/, '$1 小时前'],
    [/^(\d+)d ago$/, '$1 天前'],
    [/^(\d+)s ago$/, '$1 秒前'],
    [/^Too many attempts\. Try again in (\d+)s\.$/, '尝试次数过多，请在 $1 秒后重试。'],
    [/^Username must be (\d+)-(\d+) characters$/, '用户名长度必须为 $1–$2 个字符'],
    [/^Password must be at least (\d+) characters$/, '密码至少需要 $1 个字符'],
    [/^Password must be at most (\d+) characters$/, '密码最多 $1 个字符'],
    [/^Too many files for a single archive \(max (\d+)\)$/, '单个压缩包最多 $1 个文件']
  ];

  function pickLanguage() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'zh') { try { localStorage.setItem(STORAGE_KEY, 'zh'); } catch (e) {} return 'zh'; }
    if (q === 'en') { try { localStorage.setItem(STORAGE_KEY, 'en'); } catch (e) {} return 'en'; }
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (SUPPORTED.indexOf(saved) !== -1) return saved;
    var nav = (navigator.language || 'en').toLowerCase();
    return nav.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  var lang = pickLanguage();
  window.CV_LANG = lang;
  window.cvT = function (en, zh) { return lang === 'zh' ? zh : en; };

  if (lang === 'zh') document.documentElement.classList.add('i18n-loading');

  function translatePhrase(raw) {
    var key = raw.trim();
    if (!key) return raw;
    var out = ZH[key];
    if (out === undefined) {
      for (var i = 0; i < RULES.length; i++) {
        if (RULES[i][0].test(key)) { out = key.replace(RULES[i][0], RULES[i][1]); break; }
      }
    }
    if (out === undefined) {
      if (/^Folder deleted — removed /.test(key)) {
        out = key
          .replace('Folder deleted — removed ', '文件夹已删除 — 移除了 ')
          .replace(/(\d+) files?/g, '$1 个文件')
          .replace(/(\d+) subfolders?/g, '$1 个子文件夹')
          .replace(' and ', ' 和 ');
      }
    }
    if (out === undefined) return raw;
    out = out.replace(/（admin）/g, '（管理员）').replace(/（user）/g, '（用户）');
    return raw.replace(key, out);
  }

  function shouldSkip(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return true;
    return !!el.closest('script, style, textarea, .no-i18n, [data-no-i18n]');
  }

  function translateTextNode(node) {
    if (shouldSkip(node)) return;
    var next = translatePhrase(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  var ATTRS = ['placeholder', 'title', 'aria-label'];
  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || shouldSkip(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      var value = el.getAttribute(name);
      if (!value || !value.trim()) continue;
      var next = translatePhrase(value);
      if (next !== value) el.setAttribute(name, next);
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    translateAttrs(root);
    if (root.querySelectorAll) {
      var nodes = root.querySelectorAll('[placeholder], [title], [aria-label]');
      for (var i = 0; i < nodes.length; i++) translateAttrs(nodes[i]);
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) translateTextNode(node);
  }

  function translateTitle() {
    if (lang !== 'zh') return;
    var t = document.title;
    if (!t) return;
    var out = ZH[t];
    if (out === undefined) {
      out = t
        .replace(/^(.+) (?:—|-) Login$/, '$1 — 登录')
        .replace(/^(.+) (?:—|-) Setup$/, '$1 — 初始化')
        .replace(/^(.+) (?:—|-) Shared Files$/, '$1 — 共享文件')
        .replace(/^(.+) (?:—|-) Shared File$/, '$1 — 共享文件')
        .replace(/^Shared Folder (?:—|-) (.+)$/, '共享文件夹 — $1');
    }
    if (out && out !== t) document.title = out;
  }

  function updateToggles() {
    var buttons = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      btn.textContent = lang === 'zh' ? 'EN' : '中文';
      btn.setAttribute('title', lang === 'zh' ? 'Switch to English' : '切换到中文');
      btn.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
      if (!btn.dataset.langBound) {
        btn.dataset.langBound = '1';
        btn.addEventListener('click', function () {
          var next = lang === 'zh' ? 'en' : 'zh';
          try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
          var url = new URL(location.href);
          url.searchParams.delete('lang');
          location.replace(url.toString());
        });
      }
    }
  }

  function start() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    if (lang === 'zh') {
      walk(document.body);
      translateTitle();
      var mo = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'characterData') translateTextNode(m.target);
          else if (m.type === 'attributes') translateAttrs(m.target);
          else {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n.nodeType === 3) translateTextNode(n);
              else if (n.nodeType === 1) walk(n);
            }
          }
        }
        translateTitle();
      });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      var titleEl = document.querySelector('title');
      if (titleEl) mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    updateToggles();
    document.documentElement.classList.remove('i18n-loading');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  setTimeout(function () { document.documentElement.classList.remove('i18n-loading'); }, 3000);
})();
