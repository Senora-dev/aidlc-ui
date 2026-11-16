# Roadmap

Grounded in what upstream ships today (AI-DLC 2.11.4) and what is only proposed.

## Now (0.1, this release)

* Read-only, local, multi-workspace viewer for AI-DLC 2.x records
* Compatibility detection, tested matrix, weekly upstream probe
* Demo mode with synthetic data

## Next: reading

* **Typed event adapter**: if upstream lands RFC #1635 (typed JSONL events with ids,
  per-writer sequence numbers and correlation), add an adapter that prefers it over
  Markdown parsing. It would remove the "order uncertain" ambiguity and give
  structured question options. *Status upstream: open RFC.*
* **Team Units view**: Construction "Unit Progress" is rendered by upstream in the
  state file. aidlc-ui currently preserves it as raw fields only.
* **Commit-aware history**: read records at a git ref (`git show`) so you can compare
  an intent across branches, without checking anything out.
* **Other harness projections**: exercise `.kiro`, `.codex`, `.cursor`, `.aidlc`
  installs with real records and add them to the tested matrix.

## Supported interaction (only on an upstream contract)

aidlc-ui will **not** approve gates or answer questions by editing records or
calling internal `aidlc engine` routes. Upstream enforces human presence with
harness hooks (a person's turn must be recorded by the host). Bypassing that would
undermine the audit trail.

If upstream publishes a supported external interaction contract (for example the
structured asks of RFC #1635 Phase 3 plus an authenticated way to submit a person's
reply), aidlc-ui could add an *answer in browser* surface that goes through it.
Until then the UI says: approve in your harness.

## Team visibility (honest scope)

A local checkout only contains what has been committed and pulled. aidlc-ui shows
exactly that. Organization-wide live visibility would need either:

* a shared read-only mirror that runs aidlc-ui against a CI checkout of each repo
  (possible today, no new upstream work, still not "live"), or
* an upstream event stream / cursor API (RFC #1635 Phase 1 `--after/--follow` is the
  closest proposal). *Status: proposed, not released.*

No hosted backend, accounts or telemetry are planned for the open-source tool.
