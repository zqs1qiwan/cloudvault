# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.14.x | Yes |
| Older releases | Best effort only |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow:

https://github.com/zqs1qiwan/cloudvault/security/advisories/new

Do not open a public issue for a suspected vulnerability. Include:

- the affected version and deployment method;
- a short description of the impact;
- reproduction steps or a proof of concept;
- any relevant request/response or log excerpt, with secrets removed.

Never include Cloudflare API tokens, cookies, account IDs, bucket names, or real user data in a report.

## Scope

Reports are especially useful for:

- authentication or session bypass;
- share-token forgery or unauthorized access;
- path traversal or unintended file access;
- stored XSS in file names, previews, or shared pages;
- privilege escalation between admin and normal users;
- WebDAV authentication or authorization flaws;
- accidental exposure of R2 objects or KV data.

Cloudflare account configuration, compromised Cloudflare credentials, social engineering, and denial-of-service traffic are outside the application's control. If the issue depends on a Cloudflare service, please also report it to Cloudflare.

## What to expect

This is a small open-source project. Reports are handled on a best-effort basis, normally within three business days for an initial response. Please give reasonable time to ship a fix before public disclosure.
