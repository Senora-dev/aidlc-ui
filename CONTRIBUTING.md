# Contributing to aidlc-ui

Thanks for helping. A few principles keep this project trustworthy:

1. **Read-only, always.** No code path may write to a workspace or an AI-DLC
   installation, call `aidlc engine` routes, or simulate approvals.
2. **Version knowledge stays in adapters.** Upstream paths, field names and formats
   belong in `src/adapters/<adapter>/`. The UI (`web/`) consumes only
   `src/shared/model.ts`.
3. **Evidence over inference.** Don't show a state the records don't support.
   Prefer "unknown", "missing" or "unsupported" to a guess.
4. **Test against real upstream records**, not fixtures shaped to fit the parser.

## Setup

```bash
npm ci
npm run build        # server (tsc) + web (vite)
npm test             # vitest: real-record, robustness and security suites
npm run typecheck
```

Development with hot reload uses two terminals that share a token:

```bash
export AIDLC_UI_DEV_TOKEN=dev-$(openssl rand -hex 8)
npm run dev:server -- /path/to/workspace   # API on :4173 (tsx watch)
npm run dev:web                            # Vite on :5173, proxies /api
```

Then open `http://127.0.0.1:5173/`.

Useful helpers:

```bash
npx tsx scripts/dev/inspect.ts <workspace> [space/intent]   # what the adapter reads
node scripts/screenshots.mjs <url> <out-dir> --routes r.json  # desktop + narrow, light + dark (local Chrome)
node scripts/upstream-compat.mjs                              # probe newest upstream releases (report-only)
```

## Adding an upstream version to the tested matrix

1. Install that AI-DLC release in an **isolated HOME** (the release's
   `install.sh --from <dir>` with `HOME`, `AIDLC_BIN_DIR` and `AIDLC_INSTALL_ROOT`
   pointing to a scratch folder).
2. Generate records with `test/fixtures/upstream/generator/` (see its README). It
   drives the real engine and hooks the way upstream's own `tests/harness/scope-run.ts`
   does, with the person's words entering only through the human-turn hook.
3. Extract with `scripts/dev/extract-fixture.sh <workspace> test/fixtures/upstream/<name> fixture-host`.
4. Add expectations checked by hand against the raw files, then add the version to
   `TESTED_VERSIONS` in `src/adapters/aidlc-v2/index.ts` and to `docs/COMPATIBILITY.md`.

## Pull requests

* Keep the server dependency-free (Node standard library only).
* Include tests for new parsing behaviour, and screenshots for UI changes
  (desktop and 390 px wide).
* Check keyboard navigation and `prefers-reduced-motion`.
* Never commit real customer records. Fixture shard names are anonymised.
