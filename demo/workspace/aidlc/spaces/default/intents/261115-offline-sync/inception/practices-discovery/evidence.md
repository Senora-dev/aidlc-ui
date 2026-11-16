# Evidence

> Synthetic demo content. Project: **Lumen Notes** (fictional).

## Summary

This evidence captures what the team agreed during **practices discovery**.
It is written for reviewers who were not in the room, so every decision links back
to the question that drove it.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Storage | SQLite on device, Postgres in the cloud | Offline-first reading and writing |
| Sync | Last-writer-wins per paragraph | Simple, and conflicts are rare in practice |
| Auth | Passkeys with email fallback | Fewer passwords to manage |

## Details

1. Notes are stored locally first and synced in the background.
2. A conflict never silently drops text; both versions are kept.
3. Export to Markdown is available from day one.

```ts
export interface Note {
  id: string;
  title: string;
  body: string; // Markdown
  updatedAt: string; // ISO 8601
}
```

## Risks

- **Large notebooks**: sync may be slow above 10k notes. Mitigation: paginate.
- **Clock skew**: devices disagree on time. Mitigation: server-assigned versions.

> The person approving this stage can request changes at the gate; the agent revises
> and the gate opens again.

<script>alert('this HTML is shown as text, never executed')</script>
