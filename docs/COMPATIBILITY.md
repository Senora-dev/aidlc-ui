# Compatibility

aidlc-ui reads AI-DLC **file formats**. Upstream does not publish them as a stable
external API, so compatibility is **detected at runtime and verified per version**.
It is never assumed.

## Tested matrix

Records in `test/fixtures/upstream/` were produced by the **real upstream engine**
(native `aidlc` binaries from the GitHub releases, checksum-verified), driven without
a model through the real hooks. See [test/fixtures/upstream/README.md](../test/fixtures/upstream/README.md).

| AI-DLC version | How it was tested | Result |
| --- | --- | --- |
| **2.11.4** (stable, Claude Code harness) | Fresh workspace; 4 intents in 2 spaces (bugfix, express → complete, classic, express in a second space); Q&A, a rejected-then-revised gate, reviewer verdicts, sensor findings, an open approval gate, an open plan-approval ask, new-work routing; empty configured workspace; `test-pro` plugin with custom stages | verified |
| **2.10.0** (stable) | Workspace created and driven entirely with 2.10.0 (open gate) | verified |
| 2.10.0 records → project refreshed to **2.11.4** (upgrade) | `aidlc use 2.11.4 && aidlc config` on the 2.10.0 workspace | verified, identical intent data |
| 2.11.4 records → project refreshed to **2.10.0** (downgrade) | Upstream 2.10.0 **refuses** to refresh while workflows are active (verified). In-flight intents were archived with 2.11.4, then `aidlc config` with 2.10.0 | verified; archived intents shown as archived |
| **2.11.5-preview.20261114.1** (preview) over 2.11.4 records | `aidlc config` with the preview | verified, identical intent data |

Only the **Claude Code** harness projection was exercised end to end. Other harnesses
(`.kiro`, `.codex`, `.cursor`, `.aidlc`) write the same `aidlc/` records according to
upstream's documentation, and their installation stamps are detected generically.
They have **not** been tested with real records.

Not supported: the AI-DLC **0.x/1.x** `aidlc-docs/` layout. It is detected and
reported as incompatible, never parsed. State Versions other than **8** are
reported as unsupported.

## How an independent upgrade or downgrade is handled

You upgrade, downgrade, pin, or customise AI-DLC with upstream's own tools
(`aidlc update`, `aidlc use`, `aidlc config`). aidlc-ui never runs those, never
writes to your workspace, and has no copy of the engine. On every refresh it:

1. Reads the version from your project's `…/tools/data/aidlc-stamp.json`.
2. Runs schema probes on the actual files (stage graph shape, State Version,
   audit grammar, event vocabulary).
3. Labels the result:
   * **Verified**: version in the tested matrix and all probes pass.
   * **Compatible · untested version**: version not tested, all probes pass.
   * **Partial**: some probes fail. Readable data is shown, and gaps are marked in place.
   * **Incompatible**: records cannot be read safely. Nothing is shown as valid progress.
4. Optionally runs `aidlc version` (disable with `--no-cli-probe`) and tells you when
   the CLI on your PATH differs from the version the project is configured with.

## What may need adapter maintenance

Each item below is guarded by a probe in `scripts/upstream-compat.mjs` or by the
runtime capability checks:

* A new `State Version` (upstream bumps it when stage rows are renamed or added; v8 since 2.7.0).
* Changes to the `aidlc-state.md` section names, field labels, or checkbox legend.
* Changes to the audit block grammar (`\n---\n` separator, `**Field**: value` lines).
* Renamed or removed event types that aidlc-ui interprets (`DECISION_RECORDED`,
  `QUESTION_ANSWERED`, `GATE_APPROVED`, `STAGE_AWAITING_APPROVAL`, …). New event types
  need no change: they are shown generically.
* The shape of `stage-graph.json` or the stamp file.
* Upstream adopting a typed event log (RFC #1635). That would be a new adapter, preferred over parsing Markdown.

## Automated upstream checks

`npm run compat:upstream` (and the weekly GitHub workflow `upstream-compat.yml`)
downloads the newest stable and preview runtime tarballs, verifies their checksums,
extracts them as data (nothing is executed), and probes the files above. It only
**reports**. It never changes dependencies, code, or releases.

```
node scripts/upstream-compat.mjs                      # newest stable + newest preview
node scripts/upstream-compat.mjs --versions v2.10.0   # specific tags
```

Last run (2026-11-15): 2.11.4 and 2.11.5-preview.20261114.1 passed all probes.
2.10.0 and 2.8.0 passed. Some newer optional events (`QUESTION_ASKED`,
`QUESTION_REPLIED`, `HOST_TURN`, `REQUEST_ROUTED`) do not exist in those releases,
so that data is simply absent.

These probes check the shipped format definitions. They do **not** replace
re-running the real-record generator (`test/fixtures/upstream/generator/`) when
adding a version to the tested matrix.
