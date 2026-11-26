# CloudVault launch kit

> The public demo URL is intentionally written as `{{DEMO_URL}}` in this document. Do not replace it with a private deployment or production instance. Replace every occurrence only after the dedicated public demo is ready.

## Positioning

**Chinese one-liner**

> 不用买服务器，也不用维护数据库，把个人网盘跑在 Cloudflare Workers + R2 上。

**English one-liner**

> A serverless personal cloud drive on Cloudflare Workers + R2. No VPS, no database, no separate object-storage service.

**What we are**

CloudVault is a lightweight, single-tenant file-sharing layer for people who already use Cloudflare. It is not positioned as a full Nextcloud replacement. The proof points are:

- one Worker, one R2 bucket, one KV namespace;
- password-protected and expiring share links;
- public guest folders without an account;
- WebDAV for Finder, Explorer, rclone, and Cyberduck;
- one-click Deploy to Cloudflare;
- MIT licensed and self-hosted.

**What to say honestly**

- Cloudflare Workers and R2 quotas and billing apply.
- There is no public registration and no multi-tenant SaaS mode.
- This is a file tool, not a collaborative document suite.
- Large uploads and WebDAV behavior depend on the deployment and client.

## GitHub setup checklist

- [ ] Set **Homepage** to `{{DEMO_URL}}` after the public demo exists. Leave it empty until then; do not point it at the production instance.
- [ ] Add repository topics: `cloudflare-workers`, `cloudflare-r2`, `cloudflare-kv`, `serverless`, `cloud-storage`, `file-sharing`, `self-hosted`, `webdav`, `typescript`, `personal-cloud`.
- [ ] Upload `docs/social-preview.png` as the GitHub social preview image.
- [ ] Create the formal GitHub Release for `v1.14.7` using `docs/releases/v1.14.7.md` (the repository currently has a tag, not a release page).
- [ ] Enable private vulnerability reporting so the link in `SECURITY.md` works.
- [ ] Pin the release or add a short “Start here” block to the repository home.
- [ ] Add `good first issue`, `help wanted`, and `documentation` labels as real tasks appear.

Create the release after authenticating GitHub CLI:

```bash
gh auth login
gh release create v1.14.7 \
  --title "v1.14.7 — Build your own" \
  --notes-file docs/releases/v1.14.7.md
```

If a release for the tag already exists, edit its notes instead of creating a second release.

## Launch assets

1. `docs/social-preview.png` — 1280×640 GitHub social preview. Uses the real dashboard screenshot and the `Build your own cloud.` line.
2. A 45-second screen recording. Record at 1440×900 or 1600×1000, use the public demo, and keep the cursor movement deliberate. No voice-over is required; add short captions.
3. One technical article: “Why CloudVault runs on Workers + R2, and what that costs.” Include architecture, share-token design, WebDAV, and a realistic 100 GB / 1 TB cost example. Use current Cloudflare pricing rather than hard-coded old numbers.
4. A short limitations section in every launch post. It builds trust and prevents “free unlimited storage” expectations.

## 45-second demo storyboard

| Time | Shot | Caption |
| --- | --- | --- |
| 0–3s | Public guest page with folders and files | “Your files, without an account.” |
| 3–10s | Open the dashboard and upload a file | “Upload and organize in the browser.” |
| 10–18s | Open sharing settings, set password and expiry | “Password and expiry, per link.” |
| 18–25s | Open the generated share link | “Send one link, not an account.” |
| 25–32s | Show public guest folder and single-file preview | “Guests see only what you shared.” |
| 32–38s | Show WebDAV mount or the settings page | “Or mount it over WebDAV.” |
| 38–45s | Logo + `Build your own cloud` + repo URL | “Deploy it on your own Cloudflare account.” |

## Show HN draft

**Title**

`Show HN: CloudVault – serverless file sharing on Cloudflare Workers + R2`

**Body**

```text
Hi HN,

I built CloudVault, an open-source personal cloud drive that runs on Cloudflare Workers + R2. There is no VPS and no database to maintain: the Worker handles the app, auth, share links and WebDAV, R2 stores the files, and KV stores accounts and site settings.

What it does:
- Upload, folders, previews and ZIP downloads
- Password-protected, expiring share links
- Public guest folders without an account
- WebDAV for Finder, Explorer, rclone and Cyberduck
- Chinese/English UI and light/dark themes
- One-click deploy to Cloudflare

Why I built it: I wanted a small file-sharing layer for personal and small-team use without running a server or a separate storage stack. Cloudflare was already the right place for the compute and object storage.

Demo: {{DEMO_URL}}
Code: https://github.com/zqs1qiwan/cloudvault
Deploy: https://deploy.workers.cloudflare.com/?url=https://github.com/zqs1qiwan/cloudvault

Current limits: single-tenant only, no collaborative editing, and Workers/R2 quotas and billing apply. It is not a hosted SaaS.

I would especially appreciate feedback on the deploy flow, share-link security, and WebDAV compatibility.
```

Do not add marketing adjectives to the HN title. Reply to technical questions with specifics, and do not ask for upvotes.

## V2EX draft

**Title**

`用 Cloudflare Workers + R2 做了个开源网盘：不用 VPS，支持 WebDAV`

**Body**

```text
最近把自己的文件分享需求做成了 CloudVault，一个跑在 Cloudflare Workers + R2 上的开源网盘。

不用买 VPS，也不用维护数据库：Worker 负责应用、登录、分享链接和 WebDAV，R2 存文件，KV 存账号和站点设置。

现在支持：
- 文件/文件夹管理、图片/视频/PDF/Markdown 预览
- 带密码和有效期的分享链接
- 未登录访客访问共享文件夹
- WebDAV 挂载
- 中英文和深浅色主题
- Cloudflare 一键部署

Demo: {{DEMO_URL}}
GitHub: https://github.com/zqs1qiwan/cloudvault

目前是单租户工具，不是 Nextcloud 的完整替代，也没有在线协作编辑；Workers/R2 的额度和计费仍然适用。

主要想听听大家对部署流程、分享链接安全和 WebDAV 兼容性的意见。
```

Post in the “分享创造” node. Disclose that you are the author in the first sentence.

## Reddit r/selfhosted draft

**Title**

`I built a serverless personal cloud drive on Cloudflare Workers + R2 (open source)`

**Body**

```text
I’m the author. I wanted a small file-sharing layer for personal use without maintaining a VPS, database, or separate object-storage service.

CloudVault runs on Cloudflare Workers + R2:
- uploads, folders, previews, ZIP downloads
- password-protected and expiring share links
- public guest folders
- WebDAV for Finder, Explorer, rclone and Cyberduck
- English/Chinese UI and light/dark themes
- one-click deploy to Cloudflare

Demo: {{DEMO_URL}}
Code: https://github.com/zqs1qiwan/cloudvault

It is intentionally single-tenant and not a full Nextcloud replacement. Cloudflare quotas and billing apply, and there is no collaborative editing.

Happy to answer questions about the architecture or the deploy flow. Feedback on missing self-hosting basics is especially useful.
```

Read the subreddit rules before posting. Participate in other threads first; do not post the same text to several subreddits on the same day.

## Product Hunt draft

**Tagline**

`Build your own cloud — serverless file sharing on Cloudflare Workers + R2`

**Short description**

`An open-source personal cloud drive with share links, guest folders and WebDAV. Runs on Cloudflare Workers + R2 — no VPS, no database.`

**First comment**

```text
Hi Product Hunt, I’m the maker.

CloudVault is a small, self-hosted file tool for people who already use Cloudflare. It gives you a browser dashboard, password-protected share links, public guest folders, previews, and WebDAV without asking you to run a server or a database.

It is open source, MIT licensed, and deploys with the Cloudflare button.

Demo: {{DEMO_URL}}
Code: https://github.com/zqs1qiwan/cloudvault

It is deliberately single-tenant and not a Nextcloud replacement. Happy to answer anything about the architecture, security model, or deploy flow.
```

Launch Product Hunt only after the demo, screenshots, and deploy flow have survived the first two launch waves.

## Suggested sequence

**Week 1 — private validation**

- Invite 10–20 Cloudflare/self-hosting users.
- Watch them deploy without helping.
- Fix the first three onboarding blockers before broad posting.

**Week 2 — Chinese launch**

- V2EX “分享创造”.
- 小众软件 and HelloGitHub submissions.
- 开源中国 project post.
- Bilibili 5-minute deploy tutorial.

**Week 3 — English launch**

- Show HN on a weekday evening in China (US morning).
- r/selfhosted and r/CloudFlare, with subreddit-specific copy.
- Cloudflare Community technical post.
- awesome-selfhosted and selfh.st submissions.

**Week 4 — amplification**

- Product Hunt.
- Technical blog post and YouTube tutorial.
- Follow up on issues and publish a short changelog.

Do not post to every channel on the same day. Each channel needs replies and follow-up.

## Metrics

Track the funnel, not only stars:

- GitHub repository views and referrers;
- demo visits and which pages people open;
- clicks from the README to the Cloudflare deploy button;
- completed `/setup` deployments;
- qualified issues and pull requests;
- stars as a lagging indicator.

A reasonable first target is 50 deploy attempts, 10 qualified issues, and 100 stars within the first month. If deploy attempts are low, fix the onboarding before spending money on promotion.

## Avoid

- Buying stars, upvotes, or comments.
- Claiming “free unlimited storage” or “unlimited speed”.
- Posting the same copy to every community.
- Dropping a link and leaving without answering questions.
- Publishing a demo URL before it is isolated from production data.
