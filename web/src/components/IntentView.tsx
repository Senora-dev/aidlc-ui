import { useRef } from "react";
import type { IntentDetail, WorkspaceSnapshot } from "../../../src/shared/model";
import { absTime, LIFECYCLE, relTime } from "../format";
import { href, navigate, type Route } from "../router";
import { Artifacts } from "./Artifacts";
import { Decisions } from "./Decisions";
import { Icon } from "./Icon";
import { Timeline } from "./Timeline";
import { Workflow } from "./Workflow";
import { Badge, Issues, ProgressBar } from "./bits";

const TABS = [
  { id: "workflow", label: "Workflow", icon: "layers" },
  { id: "decisions", label: "Decisions", icon: "chat" },
  { id: "timeline", label: "History", icon: "history" },
  { id: "artifacts", label: "Artifacts", icon: "file" },
] as const;

export function IntentView({ ws, intent, route }: { ws: WorkspaceSnapshot; intent: IntentDetail; route: Route }) {
  const tab = route.tab ?? "workflow";
  const lc = LIFECYCLE[intent.lifecycle];
  const p = intent.progress;
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const go = (t: string, query?: Record<string, string | undefined>) =>
    navigate(href({ name: "intent", ws: ws.id, space: intent.space, intent: intent.dirName, tab: t as Route["tab"] }, query));

  const decisionsCount = intent.decisions.filter((d) => d.kind !== "gate-opened" && d.kind !== "review").length;
  const counts: Record<string, number | null> = { workflow: null, decisions: decisionsCount, timeline: intent.events.length, artifacts: intent.artifacts.length };

  return (
    <div className="page intent-page">
      <header className="intent-head">
        <div className="intent-title">
          <p className="eyebrow">
            <a href={href({ name: "workspace", ws: ws.id })}>{ws.name}</a> <Icon name="chevron" size={12} /> {intent.space}
          </p>
          <h1>{intent.label}</h1>
          {intent.description && <p className="lede">{intent.description}</p>}
          <div className="intent-chips">
            <Badge tone={lc.tone}>{lc.label}</Badge>
            {intent.scope && <span className="scope-chip">{intent.scope} plan</span>}
            <span className="muted small" title={absTime(intent.lastActivity)}>
              <Icon name="clock" size={13} /> Last recorded activity {relTime(intent.lastActivity)}
            </span>
            {intent.startedAt && <span className="muted small">Started {absTime(intent.startedAt)}</span>}
          </div>
        </div>
        {p && (
          <div className="intent-progress" aria-label="Progress">
            <div className="ip-numbers">
              <span className="ip-big">{p.completed}</span>
              <span className="ip-of">of {p.planned} planned stages</span>
            </div>
            <ProgressBar completed={p.completed} planned={p.planned} inProgress={p.inProgress} />
            <details className="ip-explain">
              <summary>How is this calculated?</summary>
              <p>{p.basis}</p>
              {p.recordedSummary && (
                <p className="muted small">
                  The state file's own summary: total {p.recordedSummary.total ?? "?"}, completed {p.recordedSummary.completed ?? "?"}, in progress{" "}
                  {p.recordedSummary.inProgress ?? "?"}.
                </p>
              )}
              {p.mismatch && <p className="warn-text">{p.mismatch}</p>}
            </details>
          </div>
        )}
      </header>

      {intent.pending.length > 0 && (
        <section className="pending-strip" aria-label="Waiting on you">
          <Icon name="gate" size={18} />
          <div>
            <strong>Waiting on you in your harness</strong>
            <ul>
              {intent.pending.map((d, n) => (
                <li key={n}>
                  {d.stage ? (
                    <a href={href({ name: "intent", ws: ws.id, space: intent.space, intent: intent.dirName, tab: "workflow" }, { stage: d.stage })}>{d.title}</a>
                  ) : (
                    d.title
                  )}
                  {d.since && <span className="muted small"> · since {relTime(d.since)}</span>}
                </li>
              ))}
            </ul>
            <p className="muted small">aidlc-ui is read-only. Approve or answer in the chat where you run AI-DLC.</p>
          </div>
        </section>
      )}

      <Issues issues={intent.issues.filter((i) => i.severity !== "info")} />

      <div
        className="tabs"
        role="tablist"
        aria-label="Intent views"
        onKeyDown={(e) => {
          const i = TABS.findIndex((t) => t.id === tab);
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const next = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
            go(TABS[next].id);
            tabRefs.current[next]?.focus();
          }
        }}
      >
        {TABS.map((t, i) => (
          <a
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab ${tab === t.id ? "active" : ""}`}
            href={href({ name: "intent", ws: ws.id, space: intent.space, intent: intent.dirName, tab: t.id })}
          >
            <Icon name={t.icon} size={15} /> {t.label}
            {counts[t.id] !== null && <span className="tab-count">{counts[t.id]}</span>}
          </a>
        ))}
      </div>

      <div role="tabpanel" className="tabpanel">
        {tab === "workflow" && <Workflow intent={intent} selected={route.query.get("stage")} onSelect={(slug) => go("workflow", { stage: slug ?? undefined })} onOpenArtifact={(path) => go("artifacts", { file: path })} />}
        {tab === "decisions" && <Decisions intent={intent} onStage={(slug) => go("workflow", { stage: slug })} />}
        {tab === "timeline" && <Timeline intent={intent} onStage={(slug) => go("workflow", { stage: slug })} />}
        {tab === "artifacts" && <Artifacts wsId={ws.id} intent={intent} file={route.query.get("file")} onFile={(path) => go("artifacts", { file: path })} onStage={(slug) => go("workflow", { stage: slug })} />}
      </div>
    </div>
  );
}
