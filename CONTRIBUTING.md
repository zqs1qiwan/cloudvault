# Contributing to CloudVault

CloudVault is a small, single-tenant file tool for Cloudflare Workers + R2. Contributions are welcome, especially reproducible bug reports, documentation fixes, deployment notes, and focused improvements that keep the project easy to operate.

## Setup

Requirements: Node.js 20.19+ and a Cloudflare account with R2 enabled.

```bash
git clone https://github.com/zqs1qiwan/cloudvault.git
cd cloudvault
npm install
npm run dev
```

The local Worker prints its URL. Open `/setup` to create the first administrator account.

## Before opening a pull request

- Run `npm run check`; both TypeScript and the test suite must pass.
- Add or update tests when behavior changes.
- Keep `README.md` and `README.en.md` in sync when user-facing behavior or deployment steps change.
- Do not commit `.wrangler/`, local state, cookies, API tokens, real bucket names, or personal data.
- Keep pull requests focused. Separate unrelated refactors from fixes and features.
- Describe the user problem, the chosen approach, and any migration or deployment impact.

## Code and UI conventions

- TypeScript is checked with `tsc --noEmit`.
- The UI is plain HTML/CSS/JavaScript served by the Worker; avoid adding a build-heavy frontend stack for small changes.
- The visual language is flat and minimal: Cloudflare orange for the cloud/`Cloud`, near-black for `Vault`, no gradients.
- User-facing strings should work in both Chinese and English.
- Storage must remain R2-first. Do not introduce a second source of truth for file content.

## Commit messages

Use short, scoped messages, for example:

```text
fix(share): reject expired tokens
docs(deploy): clarify KV namespace creation
```

## Security

Do not report vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md) and use GitHub's private vulnerability reporting flow.

## License

By contributing, you agree that your contribution is licensed under the MIT License.
