# 贡献指南

CloudVault 是 MIT 开源项目。欢迎 issue、文档修正、测试补充和代码 PR。

## 先读什么

- [架构](/dev/architecture)：知道东西放在哪；
- [本地开发](/dev/local)：能跑起来；
- [测试](/dev/testing)：知道怎么验证；
- 仓库根目录的 `CONTRIBUTING.md`：当前的分支、提交和 PR 约定。

## 适合第一次贡献的改动

- 文档错别字、失效链接；
- 新增一个测试用例；
- 修一个明确的 UI 小问题；
- 补充一种文件类型的预览；
- 改进错误提示。

不适合直接开 PR 的：

- 大规模重构；
- 引入数据库 / 队列 / 新框架；
- 改变分享 token 或文件 key 的语义；
- 改变默认安全策略。

这些先开 issue 讨论，避免做完才发现方向不对。

## 提 Issue

使用仓库的 Issue 模板：

- **Bug Report**：复现步骤、期望、实际、环境、日志；
- **Feature Request**：使用场景、当前替代方案、建议行为。

不要贴：

- 真实分享 token；
- 账号密码；
- 生产 R2 / KV ID；
- 完整私密文件内容。

## 提 PR

1. 从 `main` 开分支；
2. 保持改动聚焦，一个 PR 一件事；
3. 提交前跑：

```bash
npm run check
```

4. 如果改了 UI，附截图或短录屏；
5. 如果改了 API，更新 [API](/dev/api)；
6. 如果改了限制，更新 [容量与限制](/config/limits)；
7. 在 PR 描述里写清楚“为什么”，不要只写“改了什么”。

## 提交信息

仓库使用带作用域的 conventional commit 风格，例如：

```text
feat(share): add folder link expiry
fix(dav): reject depth infinity over 5000 entries
docs(guide): clarify first-run setup
```

常见作用域：

```text
api / auth / files / share / dav / ui / docs / site / test
```

不强制，但保持可读。

## 代码风格

- TypeScript strict；
- 不引入新的运行时依赖，除非确实必要；
- 优先在 `src/lib` 封装 R2 / KV / 加密，不要在 handler 里重复；
- 错误信息面向用户，不要泄露内部路径或堆栈；
- 新增公开接口要考虑缓存和限流；
- 新增页面要考虑深色主题和移动端。

## 安全漏洞

不要开公开 issue。按 `SECURITY.md` 的渠道私下报告，并给出复现步骤和影响范围。

## 文档贡献

文档站在 `wiki/`，VitePress：

```bash
cd wiki
npm install
npm run docs:dev
```

新增页面前，先在 `wiki/.vitepress/config.ts` 的侧边栏注册，避免死链。
