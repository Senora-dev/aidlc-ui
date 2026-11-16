# Architecture

aidlc-ui is a small local service plus a browser UI. It **attaches** to an AI-DLC
installation the user already owns, reads that installation's records read-only,
and renders them. It does not contain, fork, bundle, install or drive the AI-DLC
engine.

```
 your workspace (owned by you and upstream)          aidlc-ui (owned by this project)
 ┌───────────────────────────────────────┐   read   ┌──────────────────────────────────────────┐
 │ .claude/ (or .kiro/, .codex/, .aidlc/) │ ───────▶ │ adapters/aidlc-v2   (version-specific)    │
 │   tools/data/aidlc-stamp.json          │   only   │   state-file.ts  audit.ts  stage-defs.ts │
 │   tools/data/stage-graph.json          │          │   intent.ts      index.ts (probes/compat) │
 │   knowledge/aidlc-shared/*.md          │          │ adapters/legacy  (detect, never parse)   │
 │ aidlc/spaces/<space>/intents/…         │          ├──────────────────────────────────────────┤
 │   intents.json                         │          │ shared/model.ts  (version-neutral model) │
 │   <record>/aidlc-state.md              │          ├──────────────────────────────────────────┤
 │   <record>/audit/<writer>.md           │          │ server/  node:http, RootFs, watcher, SSE │
 │   <record>/<phase>/<stage>/*           │          ├──────────────────────────────────────────┤
 └───────────────────────────────────────┘          │ web/     React UI (model only)           │
                                                     └──────────────────────────────────────────┘
 optional: `aidlc version` (documented public command) → version-skew notice only
```

* **No runtime dependencies** for the service (Node ≥ 20.19 standard library only).
  The UI is prebuilt with Vite + React and served as static files.
* **Version-specific knowledge lives only in `src/adapters/*`.** Frontend components
  consume `src/shared/model.ts` and never see upstream paths or field spellings,
  except as opaque `SourceRef`s used to link back to the raw record.
* **Preferences** (registered workspaces, chosen installation) live in aidlc-ui's
  own config directory (`~/Library/Application Support/aidlc-ui`, `%APPDATA%\aidlc-ui`,
  or `$XDG_CONFIG_HOME/aidlc-ui`), never inside a workspace.

## Upstream inspection (evidence)

Inspected on 2026-11-15:

| Item | Value |
| --- | --- |
| Repository | https://github.com/awslabs/aidlc-workflows |
| `main` HEAD inspected | `8c4f79b4b77c5a64738b01b350be2bf72c357dae` (2026-11-15) |
| Latest stable | `v2.11.4` → commit `61fdb122428d86b56b7e8d598787095f2c97d3e1` (published 2026-11-13) |
| Latest preview | `v2.11.5-preview.20261114.1` → commit `50a9e926c38fc8a24b386c656f8102fd1034d403` |
| Older stable also run | `v2.10.0` → commit `2a883858f5483bce3b48f43b8f6d3ca2c042d6ae` |

Binaries and runtime tarballs were downloaded from the GitHub releases, verified
against each release's `checksums.txt`, and installed with the release's own
`install.sh --from <dir>` into an isolated `HOME`. Nothing was installed on the
developer's real machine paths.

### Released vs proposed

| Topic | Status found | What aidlc-ui does |
| --- | --- | --- |
| Per-intent records (`aidlc/spaces/<space>/intents/<YYMMDD-label>/`), `intents.json`, `aidlc-state.md`, per-clone audit shards | **Released** (documented in `docs/guide/03-spaces-and-intents.md`, `10-state-and-audit.md`; State Version 8 since 2.7.0) | Primary data source |
| `aidlc engine audit history` / `log answers` (JSON) | **Released but explicitly not a stable interface**: `docs/guide/12-cli-commands.md` says "like every `aidlc engine` route they are harness machinery, not a stable interface for your own scripts"; `aidlc engine --help` prints "Engine machinery - generated harness surfaces only; not for human scripts" | **Not used** |
| `aidlc version` | Released, listed in public `aidlc --help` | Optional probe for version skew only |
| RFC #1635 "run-state contract" (typed JSONL events, cursors, structured asks) | **Open proposal**, not on main | Not assumed; listed as a future adapter in [ROADMAP.md](ROADMAP.md) |
| Issue #2803 browser view (`scripts/aidlc-viz` on a contributor fork) | **Open issue**, unmerged fork branch | Not used; its approach (read the real v2 record files, confine reads to the record, render Markdown as untrusted) matches ours |
| Review UI branch `feature/review-ui-html-artifacts` / `docs/rfcs/review-ui-redesign.md` (mentioned in #2803) | Experimental branch, not released | Not used |
| External plugin contract | Released for adding stages/agents/commands **inside** AI-DLC (`docs/harness-engineering/10-authoring-a-plugin.md`), not an external read API | Plugin stages are read from the compiled `stage-graph.json` (`plugin` field) |
| Interaction (approve/answer) from outside the harness | **No supported external contract.** Approvals require a human turn recorded by the harness's own hook; the engine refuses otherwise (verified: `log answer` without a recorded human turn is refused) | aidlc-ui is read-only and shows "approve in your harness" |

### Data sources the adapter reads

| Need | Source (relative to workspace root) | Notes |
| --- | --- | --- |
| Installed version, harness | `<harness>/tools/data/aidlc-stamp.json`, `harness.json` | Written by `aidlc config`. Any dot-folder with this stamp is treated as an installation, so no hardcoded harness list |
| Workflow definitions | `<harness>/tools/data/stage-graph.json`; fallback `<harness>/aidlc-common/stages/*/*.md` frontmatter | Includes plugin stages (`plugin` field) |
| Known event vocabulary | `<harness>/knowledge/aidlc-shared/audit-format.md` | Unknown events are still shown, labelled "unrecognised" |
| Spaces | directories under `aidlc/spaces/` | `aidlc/active-space` (per-user cursor) only for an "active" badge |
| Intents | `intents.json` (lenient JSON, as upstream documents) ∪ record folders on disk | Missing either side is reported |
| Execution status | `<record>/aidlc-state.md` Stage Progress checkboxes `[ ] [-] [?] [R] [x] [S]` + `EXECUTE/SKIP` | Phases and stages come from this file's own headings and rows |
| History, decisions, gates | `<record>/audit/*.md` blocks split on `\n---\n`; first `**Field**:` wins | Same-second cross-writer ties marked "order uncertain"; HOST_TURN withdrawals and conflict-copy duplicates handled like upstream's reader |
| Artifacts | files in `<record>/<phase>/<stage>/` | Hidden engine folders (`.aidlc-*`) are never read |

**Deliberately not read:** `.aidlc-engine/`, `.aidlc-sessions/`, `.aidlc-sensors/`,
`runtime-graph.json`, `active-directive.json`, and other gitignored, transient engine
files. They are private engine caches, and the durable records above carry the same facts.

## Adapter contract

`src/adapters/index.ts#scanWorkspace(fs, opts)` returns a `WorkspaceSnapshot`
(summaries) plus a map of `IntentDetail`s. An adapter must:

1. **Probe, don't assume.** Report each capability as supported / degraded /
   unavailable / unsupported, with the evidence it probed.
2. **Classify compatibility** using version and schema together: `verified`
   (tested version, all probes pass), `compatible` (untested version, all probes
   pass), `partial` (some probes fail; readable data shown with gaps marked),
   `incompatible` (records exist but cannot be read safely), `not-detected`.
3. **Never show incompatible data as valid.** A state file with an unsupported
   `State Version` gets `dataStatus: "unsupported"`, no progress, and an error.
4. **Distinguish** `missing` (expected record absent), `unsupported`, `stale`
   (last refresh failed; previous snapshot kept), `empty` (valid, nothing recorded)
   and `error`.
5. **Preserve unknowns**: unknown state sections and fields, unknown checkbox values
   (`unknown` + raw text), unknown event types and fields.
6. **Keep every value traceable** with a `SourceRef` (file + block/line).

Adding support for a future upstream format (for example the RFC #1635 JSONL
events) means adding a new adapter directory. The UI does not change.

## Derived values and their honesty rules

* **Progress** = stage rows marked `EXECUTE` that are checked `[x]`, divided by all
  `EXECUTE` rows. `[S]` (skipped during the run) is reported separately and never
  counted as done. The state file's own "Execution Plan Summary" is shown beside it,
  and any mismatch is called out.
* **Current stage**: the first row in `[?]`, `[R]` or `[-]`, else the recorded
  `Current Stage`. It is never shown for completed intents.
* **Activity**: the latest audit timestamp. The UI says "last recorded activity" and
  never infers that an agent is running now. Upstream records no such signal.
* **Pending decisions**: a stage in `[?]` (gate open), or a question with no answer
  in the record while its stage is still active. Questions are closed by an answer
  row in the same stage (upstream: "one reply closes every question logged for the
  menu it answered") or by a later row naming the question's id. A question whose
  stage moved on without an answer row is shown as "closed without a recorded
  answer". Nothing is reconstructed.
* **Attention** on a stage: `SENSOR_FAILED` without a later `SENSOR_PASSED` for the
  same sensor and output; a revision in progress. aidlc-ui never claims "blocked".

## Live refresh

`fs.watch` (recursive on `aidlc/`, plus the workspace root) is only a *signal*.
Signals are debounced (300 ms), and a 4 s stat-signature poll catches anything the
watcher misses. A refresh re-reads everything. If any record reads as an error
(for example a half-written registry), it retries three times with back-off before
accepting and marking it. If the whole read fails, the previous snapshot is kept and
marked `stale` with the error and the time of the last success. The browser gets
change notices over Server-Sent Events and re-fetches.

## Security

See [SECURITY.md](SECURITY.md).
