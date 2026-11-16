# Security model

aidlc-ui runs on your machine and reads project files that may contain sensitive
material. It is designed so that the only party who can read them through aidlc-ui
is you, in your own browser.

| Threat | Mitigation | Test |
| --- | --- | --- |
| Network exposure | Binds to loopback only (`127.0.0.1`, `::1`, `localhost`). Any other `--host` is refused | `security.test.ts` |
| DNS rebinding | `Host` header must be `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, otherwise 421 | ✓ |
| Cross-origin reads/writes (CSRF) | Every `/api` call needs a random per-launch token that exists only in the served page. A foreign `Origin` or `Sec-Fetch-Site: cross-site` gets 403. State-changing requests must carry a same-origin `Origin`. No CORS headers are ever sent | ✓ |
| Path traversal | `RootFs` rejects absolute paths, `..`, backslash tricks and NUL bytes | ✓ |
| Symlink escape | Every read is `realpath`-resolved and must stay inside the workspace's real root. Symlinked artifact entries are skipped | ✓ |
| Over-broad file access | The file API serves only non-hidden paths under `aidlc/`. Engine folders (`.aidlc-*`, sessions) and the rest of your repo are not exposed | ✓ |
| Malicious artifact content (XSS) | Markdown is rendered with raw HTML disabled; `javascript:`, `data:`, `vbscript:` and `file:` links are dropped; external links get `noopener noreferrer`; images are never fetched; strict CSP (`script-src 'self'`, no inline script, `frame-ancestors 'none'`) | ✓ |
| Writes to your workspace | No write path exists in the service; files are opened `O_RDONLY`. A test hashes a real workspace before and after browsing every view | ✓ |
| Running workspace code | Nothing from the workspace is executed. The only process ever started is `aidlc version` (optional), with an argument array, no shell, a neutral working directory, a 4 s timeout and a 64 KB output cap | n/a |
| Data leaving the machine | No telemetry, no external requests. Fonts are bundled. The service makes no outbound connections | n/a |
| Large files | Reads are bounded (2 MB per artifact view, 32 MB per audit shard) | n/a |

Preferences are stored with mode `0600` in aidlc-ui's own config directory.

To report a vulnerability, open a private security advisory on the project's
GitHub repository rather than a public issue.
