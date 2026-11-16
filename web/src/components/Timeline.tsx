import { useMemo, useState } from "react";
import type { AuditEvent, IntentDetail } from "../../../src/shared/model";
import { absTime, humanize } from "../format";
import { Icon } from "./Icon";
import { Empty, SourceLink } from "./bits";

const GROUPS: Array<{ id: string; label: string; test: (t: string) => boolean }> = [
  { id: "lifecycle", label: "Lifecycle", test: (t) => /^(WORKFLOW|PHASE|STAGE)_/.test(t) },
  { id: "decisions", label: "Decisions", test: (t) => /DECISION|GATE_|QUESTION|APPROVAL|SUMMARY|REQUEST_ROUTED|POLICY|VERIFICATION/.test(t) },
  { id: "artifacts", label: "Artifacts", test: (t) => /^ARTIFACT_/.test(t) },
  { id: "checks", label: "Checks & reviews", test: (t) => /^SENSOR_|^REVIEW|GUARDRAIL/.test(t) },
  { id: "sessions", label: "Sessions & turns", test: (t) => /SESSION|_TURN$|SUBAGENT/.test(t) },
  { id: "notes", label: "Notes", test: (t) => t === "NOTE" },
];

export function Timeline({ intent, onStage }: { intent: IntentDetail; onStage: (slug: string) => void }) {
  const [active, setActive] = useState<Set<string>>(new Set(["lifecycle", "decisions", "artifacts", "notes", "other"]));
  const [q, setQ] = useState("");
  const stageName = useMemo(() => new Map(intent.phases.flatMap((p) => p.stages.map((s) => [s.slug, s.name] as const))), [intent.phases]);
  const groupOf = (t: string) => GROUPS.find((g) => g.test(t))?.id ?? "other";
  const query = q.trim().toLowerCase();
  const list = intent.events.filter((e) => {
    if (!active.has(groupOf(e.type))) return false;
    if (!query) return true;
    return [e.type, e.heading, e.stage, e.body, ...e.fields.flat()].some((x) => x?.toLowerCase().includes(query));
  });

  if (!intent.events.length)
    return (
      <Empty icon="history" title="No history recorded">
        <p>No audit shards were found for this intent in this checkout.</p>
      </Empty>
    );

  const toggle = (id: string) =>
    setActive((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="chips" role="group" aria-label="Event filters">
          {[...GROUPS, { id: "other", label: "Other", test: () => false }].map((g) => (
            <button key={g.id} className={`chip ${active.has(g.id) ? "on" : ""}`} aria-pressed={active.has(g.id)} onClick={() => toggle(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <label className="search">
          <Icon name="search" size={14} />
          <span className="sr-only">Search history</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" />
        </label>
      </div>
      <p className="muted small">
        {list.length} of {intent.events.length} events from {intent.shards.length} audit shard{intent.shards.length === 1 ? "" : "s"}. Ordered by timestamp, then
        writer, then position. "Order uncertain" marks same-second entries from different writers.
      </p>
      <ol className="tl-list">
        {list.map((e) => (
          <TimelineRow key={`${e.id}-${e.type}`} e={e} stageName={stageName} onStage={onStage} />
        ))}
      </ol>
    </div>
  );
}

function TimelineRow({ e, stageName, onStage }: { e: AuditEvent; stageName: Map<string, string>; onStage: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const fields = e.fields.filter(([k]) => k !== "Stage" && k !== "Stage slug");
  return (
    <li className={`tl-row ${e.withdrawn ? "withdrawn" : ""} ${e.known ? "" : "unknown-type"}`}>
      <time className="tl-time mono" dateTime={e.timestamp ?? undefined}>
        {e.timestamp ? absTime(e.timestamp) : "no timestamp"}
      </time>
      <div className="tl-main">
        <div className="tl-head">
          <button className="tl-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="chevron" size={12} className={open ? "rot" : ""} />
            <span className="tl-type">{e.type === "NOTE" ? `Note: ${e.heading ?? ""}` : e.heading ?? humanize(e.type)}</span>
          </button>
          <code className="tl-code">{e.type}</code>
          {!e.known && <span className="tiny-tag" title="Not documented by the selected installation; shown generically">unrecognised</span>}
          {e.unordered && <span className="unordered">order uncertain</span>}
          {e.withdrawn && <span className="tiny-tag">withdrawn by host turn</span>}
          {e.stage && (
            <button className="linkish small" onClick={() => onStage(e.stage!)}>
              {stageName.get(e.stage) ?? e.stage}
            </button>
          )}
        </div>
        {open && (
          <div className="tl-detail">
            {fields.length > 0 && (
              <dl className="kv">
                {fields.map(([k, v], i) => (
                  <div key={i}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {e.body && <pre className="raw small">{e.body}</pre>}
            <SourceLink source={e.source} label={`${e.shard.split("/").pop()} · block ${e.pos}`} />
          </div>
        )}
      </div>
    </li>
  );
}
