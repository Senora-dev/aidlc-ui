# Real upstream records

Every workspace here was produced by the **real AI-DLC engine**, not written by hand:

* native `aidlc` binaries for **2.10.0**, **2.11.4** and **2.11.5-preview.20261114.1**,
  downloaded from https://github.com/awslabs/aidlc-workflows/releases and verified
  against each release's `checksums.txt`;
* installed with the release's own `install.sh --from` into an isolated `HOME`;
* projects set up with `aidlc config --harness claude`;
* workflows driven **without a model** by `generator/`, which runs the engine commands
  a directive names and fires the hooks Claude Code would fire. The person's words go
  in only through the real human-turn hook (`aidlc engine hook record-human-turn`).
  This mirrors upstream's own `tests/harness/scope-run.ts`. The engine enforced every
  guard: answers without a recorded human turn were refused, reviews had to come from
  a dispatched reviewer subagent, and so on.

| Fixture | Produced by |
| --- | --- |
| `populated` | 2.11.4: bugfix (rejected+revised gate, open plan approval), express (complete), classic (sensor findings), express in space `payments-team` (open gate) |
| `custom` | 2.11.4 + upstream's `test-pro` plugin composed with `aidlc engine plugin sync`; intent on the plugin scope, custom stage at an open gate |
| `empty-configured` | 2.11.4 `aidlc config` only, no intents |
| `v2100` | created and driven entirely with 2.10.0 |
| `upgraded` | `v2100`, then `aidlc use 2.11.4 && aidlc config` |
| `downgraded` | `populated`, in-flight intents archived with 2.11.4, then `aidlc use 2.10.0 && aidlc config` |
| `preview` | `populated`, then `aidlc config` with 2.11.5-preview.20261114.1 |

Extraction (`scripts/dev/extract-fixture.sh`) keeps only what aidlc-ui reads: the
`aidlc/spaces/**` records (without hidden engine folders) and the installation's
stamp, stage graph, scopes and format references. **Audit shard files were renamed**
from `<hostname>-<token>.md` to `fixture-host-<token>.md` for privacy. Shard names are
opaque to readers. Artifact *contents* are placeholder text written by the generator.
The session id and git name ("Demo Dev") are synthetic.

To regenerate, see `generator/` (Python 3, plus an isolated AI-DLC install on PATH;
set `S` to a scratch folder holding the generator files and `CLAUDE_CODE_SESSION_ID`
to a synthetic id).
