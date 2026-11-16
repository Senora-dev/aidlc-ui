import type { IntentSummary, WorkspaceSnapshot } from "../../../src/shared/model";
import { absTime, COMPAT, humanize, LIFECYCLE, relTime } from "../format";
import { href } from "../router";
import { Icon } from "./Icon";
import { Badge, DataStatusNote, Empty, Issues, ProgressBar } from "./bits";

export function Overview({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const intents = snapshot.spaces.flatMap((s) => s.intents);
  const waiting = intents.filter((i) => i.pending.length > 0);
  const inFlight = intents.filter((i) => i.lifecycle === "in-flight" || i.lifecycle === "parked");
  const inst = snapshot.installations.find((i) => i.harnessDir === snapshot.selectedInstallation);
  const compat = COMPAT[snapshot.compatibility.level];
  const blocking = snapshot.compatibility.issues.filter((i) => i.severity !== "info");

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{snapshot.name}</h1>
          <p className="mono muted small path-line">{snapshot.demo ? "Bundled synthetic demo data" : snapshot.root}</p>
        </div>
      </header>

      <section className="summary-strip" aria-label="Connection summary">
        <a className="summary-card" href={href({ name: "connection", ws: snapshot.id })}>
          <span className="summary-label">Installation</span>
          <span className="summary-value">{inst?.frameworkVersion ? `AI-DLC ${inst.frameworkVersion}` : "Not found"}</span>
          <span className="summary-sub">{inst ? `${inst.productName ?? inst.distribution ?? ""} · ${inst.harnessDir}` : "Records only"}</span>
        </a>
        <a className="summary-card" href={href({ name: "connection", ws: snapshot.id })}>
          <span className="summary-label">Compatibility</span>
          <span className="summary-value">
            <Badge tone={compat.tone}>{compat.label}</Badge>
          </span>
          <span className="summary-sub">{snapshot.compatibility.adapterId ?? "no adapter"}</span>
        </a>
        <div className="summary-card">
          <span className="summary-label">Intents</span>
          <span className="summary-value">{intents.length}</span>
          <span className="summary-sub">
            {inFlight.length} in flight · {snapshot.spaces.length} space{snapshot.spaces.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className={`summary-card ${waiting.length ? "attention" : ""}`}>
          <span className="summary-label">Waiting on you</span>
          <span className="summary-value">{waiting.reduce((n, i) => n + i.pending.length, 0)}</span>
          <span className="summary-sub">pending decisions recorded</span>
        </div>
      </section>

      {blocking.length > 0 && (
        <section className="panel" aria-label="Compatibility issues">
          <h2 className="h-small">Needs attention</h2>
          <Issues issues={blocking} />
        </section>
      )}

      {snapshot.compatibility.level === "not-detected" && (
        <Empty icon="search" title="No AI-DLC records here yet">
          <p>
            aidlc-ui did not find <code>aidlc/spaces</code> or an AI-DLC installation in this folder. If AI-DLC is set up here, start a workflow in your harness (for
            example <code>/aidlc Build …</code>) and it appears automatically.
          </p>
        </Empty>
      )}

      {snapshot.spaces.map((space) => (
        <section className="space-section" key={space.name} aria-labelledby={`space-${space.name}`}>
          <div className="space-head">
            <h2 id={`space-${space.name}`}>
              <span className="muted">Space</span> {space.name}
            </h2>
            {space.active && <span className="tiny-tag">active</span>}
            <DataStatusNote status={space.registry.status} />
          </div>
          {space.intents.length === 0 ? (
            <Empty title="No intents in this space yet">
              <p>{space.registry.detail ?? "Intents appear here when you start work with /aidlc in your harness."}</p>
            </Empty>
          ) : (
            <div className="intent-grid">
              {space.intents.map((i) => (
                <IntentCard key={i.dirName} wsId={snapshot.id} intent={i} />
              ))}
            </div>
          )}
        </section>
      ))}

      {intents.length > 0 && (
        <p className="muted small explain">
          <Icon name="info" size={14} /> Progress counts the stages each intent's plan marks to execute, as checked off in its <code>aidlc-state.md</code>. Times are the
          last <em>recorded</em> activity. aidlc-ui cannot tell whether an agent is running right now.
        </p>
      )}
    </div>
  );
}

function IntentCard({ wsId, intent }: { wsId: string; intent: IntentSummary }) {
  const lc = LIFECYCLE[intent.lifecycle];
  const p = intent.progress;
  return (
    <a className={`intent-card lc-${intent.lifecycle}`} href={href({ name: "intent", ws: wsId, space: intent.space, intent: intent.dirName })}>
      <div className="ic-top">
        <Badge tone={lc.tone}>{lc.label}</Badge>
        {intent.scope && <span className="scope-chip">{intent.scope}</span>}
        {intent.active && <span className="tiny-tag" title="The space's active-intent cursor (per-user)">active</span>}
      </div>
      <h3>{intent.label}</h3>
      {intent.description && <p className="ic-desc">{intent.description}</p>}
      {p ? (
        <div className="ic-progress">
          <ProgressBar completed={p.completed} planned={p.planned} inProgress={p.inProgress} />
          <span className="ic-count">
            {p.completed}/{p.planned}
          </span>
        </div>
      ) : (
        <DataStatusNote status={intent.dataStatus === "ok" ? "missing" : intent.dataStatus} />
      )}
      <dl className="ic-meta">
        <div>
          <dt>{intent.lifecycle === "archived" ? "Stopped at" : intent.lifecycle === "complete" ? "Finished" : "Current stage"}</dt>
          <dd>{intent.lifecycle === "complete" ? "All planned stages" : intent.currentStage?.name ?? "—"}</dd>
        </div>
        <div>
          <dt>Last recorded activity</dt>
          <dd title={absTime(intent.lastActivity)}>{relTime(intent.lastActivity)}</dd>
        </div>
      </dl>
      {intent.pending.length > 0 && (
        <ul className="ic-pending">
          {intent.pending.slice(0, 3).map((d, n) => (
            <li key={n}>
              <Icon name={d.kind === "approval-gate" ? "gate" : "question"} size={14} /> {d.title}
            </li>
          ))}
        </ul>
      )}
      {intent.issues.some((x) => x.severity !== "info") && (
        <p className="ic-issue">
          <Icon name="warning" size={14} /> {intent.issues.find((x) => x.severity !== "info")?.message}
        </p>
      )}
      {intent.recordedStatus && intent.lifecycle === "in-flight" && <p className="ic-recorded muted small">Recorded status: {humanize(intent.recordedStatus)}</p>}
    </a>
  );
}
