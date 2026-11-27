# 在线预览

CloudVault 的预览尽量用浏览器原生能力，不把文件转码成另一种格式。

## 支持的类型

| 类型 | 预览方式 |
| --- | --- |
| 图片 `image/*` | 全屏灯箱，可在当前目录的图片之间前后切换 |
| 视频 `video/*` | 原生 `<video controls>`，支持 Range 拖动 |
| 音频 `audio/*` | 原生 `<audio controls>` |
| PDF `application/pdf` | `<iframe>` 内嵌浏览器 PDF 查看器 |
| Markdown | 服务端取回文本，前端用 marked 渲染，DOMPurify 清洗 |
| 代码 / 纯文本 | 等宽字体 + Prism 语法高亮 |
| 其他 | 显示“此文件类型不支持预览”，仍可下载 |

Office 文档（`.docx`、`.xlsx`、`.pptx`）没有内置渲染器，会走“不支持预览”；可以下载后用本地应用打开。

## 图片灯箱

- 点击图片打开全屏；
- 左右箭头或键盘切换当前目录里的其他图片；
- `Esc` 关闭；
- 图片通过 `/api/files/preview?key=...` 读取，不暴露 R2 公网地址。

## 视频与音频

- 直接使用浏览器原生播放器；
- 服务端支持单段 Range 请求，因此可以拖动进度；
- 预览响应带 `Accept-Ranges: bytes`；
- 大视频不需要先完整下载。

## Markdown 与代码

Markdown 预览链路：

```text
R2 读取文本
→ marked 转 HTML
→ DOMPurify 清洗
→ 插入预览面板
```

代码预览不会执行文件里的脚本，只做语法高亮。预览面板本身不是可执行的页面，服务端对 `inline` 内容还会附加沙箱 CSP。

## 分享页预览

单文件分享页支持同样的预览：

```text
/s/<token>/preview
```

图片分享页会直接显示预览；PDF 和视频按浏览器能力显示；不支持的类型显示下载按钮。

## 安全边界

- 预览内容的响应带 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`；
- `X-Content-Type-Options: nosniff`；
- 对可脚本类型，强制以附件形式返回，避免在站点同源下执行用户上传的 HTML / SVG / JS；
- 页面本身有 `X-Frame-Options: DENY`，不能被第三方站点嵌入。

> 即使上传的是 `.html`，也不要期待它会在 CloudVault 域名下渲染成网页。这是有意的安全选择：用户文件是数据，不是站点代码。
