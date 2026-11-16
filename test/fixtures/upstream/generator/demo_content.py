"""Richer synthetic artifact text for the demo workspace (fictional project 'Lumen Notes')."""
import json, os

TOPICS = {}


def body(path, stage, topic):
    name = os.path.basename(path)
    title = name.rsplit(".", 1)[0].replace("-", " ").title()
    if name.endswith(".json"):
        return json.dumps({"schema": "aidlc-traceability/1", "elements": [], "links": []}, indent=2) + "\n"
    if name.endswith("-questions.md"):
        return (f"# {title}\n\n> Synthetic demo content for **{topic}**.\n\n## Question 1\nWhich outcome matters most for this stage?\n\n"
                "A) Reliability for existing users\nB) Speed of delivery\nX) Other\n\n[Answer]: A\n\n## Question 2\nWho signs off on the result?\n\nA) Product lead\nB) Engineering lead\n\n[Answer]: A\n")
    if name == "memory.md":
        return f"# Stage diary: {stage}\n\n- Kept the scope narrow after the first review.\n- Noted an open risk about offline sync conflicts.\n"
    return f"""# {title}

> Synthetic demo content. Project: **{topic}** (fictional).

## Summary

This {title.lower()} captures what the team agreed during **{stage.replace('-', ' ')}**.
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
export interface Note {{
  id: string;
  title: string;
  body: string; // Markdown
  updatedAt: string; // ISO 8601
}}
```

## Risks

- **Large notebooks**: sync may be slow above 10k notes. Mitigation: paginate.
- **Clock skew**: devices disagree on time. Mitigation: server-assigned versions.

> The person approving this stage can request changes at the gate; the agent revises
> and the gate opens again.

<script>alert('this HTML is shown as text, never executed')</script>
"""
