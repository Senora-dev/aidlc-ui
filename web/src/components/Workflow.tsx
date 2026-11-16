import { useEffect, useMemo, useRef, useState } from "react";
import type { IntentDetail, Phase, Stage } from "../../../src/shared/model";
import { absTime, humanize, relTime, STAGE_STATE } from "../format";
import { Icon } from "./Icon";
import { Badge, Empty, SourceLink } from "./bits";

const NODE_ICON: Record<string, string> = {
  completed: "check",
  "in-progress": "dot",
  "awaiting-approval": "gate",
  revising: "revise",
  skipped: "skip",
  pending: "",
  "not-in-plan": "",
  unknown: "question",
};

export function Workflow({ intent, selected, onSelect, onOpenArtifact }: { intent: IntentDetail; selected: string | null; onSelect: (slug: string | null) => void; onOpenArtifact: (path: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const stages = intent.phases.flatMap((p) => p.stages);
  const sel = stages.find((s) => s.slug === selected) ?? null;
  const visiblePhases = useMemo(
    () => intent.phases.map((p) => ({ ...p, visible: showAll ? p.stages : p.stages.filter((s) => s.state !== "not-in-plan") })),
    [intent.phases, showAll],
  );
  const hiddenCount = stages.filter((s) => s.state === "not-in-plan").length;
  const navOrder = visiblePhases.flatMap((p) => p.visible.map((s) => s.slug));
  const btns = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (sel && !navOrder.includes(sel.slug) && sel.state === "not-in-plan") setShowAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!intent.phases.length)
    return (
      <Empty icon="layers" title="No workflow structure recorded">
        <p>{intent.workflowStructureSource}</p>
      </Empty>
    );

  const onKey = (e: React.KeyboardEvent, slug: string) => {
    const idx = navOrder.indexOf(slug);
    let next: string | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = navOrder[idx + 1];
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = navOrder[idx - 1];
    if (e.key === "Home") next = navOrder[0];
    if (e.key === "End") next = navOrder[navOrder.length - 1];
    if (next) {
      e.preventDefault();
      btns.current.get(next)?.focus();
    }
    if (e.key === "Escape") onSelect(null);
  };

  return (
    <div className={`workflow ${sel ? "has-panel" : ""}`}>
      <div className="wf-main">
        <div className="wf-toolbar">
          <Legend />
          {hiddenCount > 0 && (
            <button className="btn small ghost" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
              {showAll ? `Hide ${hiddenCount} stages not in plan` : `Show ${hiddenCount} stages not in plan`}
            </button>
          )}
        </div>
        <ol className="phases" aria-label="Phases and stages">
          {visiblePhases.map((phase, pi) => (
            <PhaseLane key={phase.id} phase={phase} visible={phase.visible} index={pi} selected={sel?.slug ?? null} onSelect={onSelect} onKey={onKey} btns={btns.current} />
          ))}
        </ol>
        <p className="muted small explain">
          <Icon name="info" size={14} /> Structure source: {intent.workflowStructureSource}. Phases and stages appear exactly as recorded, custom ones included.
        </p>
      </div>
      {sel && <StagePanel stage={sel} intent={intent} onClose={() => onSelect(null)} onOpenArtifact={onOpenArtifact} />}
    </div>
  );
}

function PhaseLane({ phase, visible, index, selected, onSelect, onKey, btns }: { phase: Phase; visible: Stage[]; index: number; selected: string | null; onSelect: (s: string) => void; onKey: (e: React.KeyboardEvent, s: string) => void; btns: Map<string, HTMLButtonElement> }) {
  const done = phase.stages.filter((s) => s.state === "completed").length;
  const planned = phase.stages.filter((s) => s.inPlan).length;
  return (
    <li className={`phase phase-${phase.status}`} style={{ ["--i" as string]: index }}>
      <div className="phase-head">
        <span className="phase-index">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3>{phase.name}</h3>
          <p className="phase-meta">
            {phase.rawStatus ? humanize(phase.rawStatus) : "No phase status recorded"}
            {planned > 0 && ` · ${done}/${planned}`}
          </p>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="phase-empty">{phase.stages.length ? `${phase.stages.length} stage(s), none in this plan` : "No stages recorded"}</p>
      ) : (
        <ol className="track">
          {visible.map((s) => (
            <li key={s.slug} className={`node-wrap st-${s.state}`}>
              <button
                ref={(el) => {
                  if (el) btns.set(s.slug, el);
                  else btns.delete(s.slug);
                }}
                className={`node ${selected === s.slug ? "selected" : ""}`}
                onClick={() => onSelect(s.slug)}
                onKeyDown={(e) => onKey(e, s.slug)}
                aria-pressed={selected === s.slug}
                aria-label={`${s.name}: ${STAGE_STATE[s.state].label}${s.attention.length ? `, ${s.attention.length} note(s)` : ""}`}
              >
                <span className="node-dot">
                  {NODE_ICON[s.state] && <Icon name={NODE_ICON[s.state]} size={s.state === "in-progress" ? 10 : 14} />}
                </span>
                <span className="node-label">
                  <span className="node-name">{s.name}</span>
                  <span className="node-state">
                    {STAGE_STATE[s.state].label}
                    {s.custom && <span className="custom-tag">plugin</span>}
                    {s.definitionMissing && <span className="custom-tag warn">custom</span>}
                  </span>
                </span>
                {s.attention.length > 0 && <span className="node-flag" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    ["completed", "Completed"],
    ["in-progress", "In progress"],
    ["awaiting-approval", "Awaiting approval"],
    ["revising", "Revising"],
    ["skipped", "Skipped"],
    ["pending", "Pending"],
  ];
  return (
    <ul className="legend" aria-label="Legend">
      {items.map(([k, l]) => (
        <li key={k} className={`st-${k}`}>
          <span className="legend-dot" /> {l}
        </li>
      ))}
    </ul>
  );
}

function StagePanel({ stage, intent, onClose, onOpenArtifact }: { stage: Stage; intent: IntentDetail; onClose: () => void; onOpenArtifact: (path: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [stage.slug]);
  const meta = STAGE_STATE[stage.state];
  const decisions = intent.decisions.filter((d) => d.stage === stage.slug && d.kind !== "gate-opened");
  const events = intent.events.filter((e) => e.stage === stage.slug);
  const artifacts = intent.artifacts.filter((a) => stage.artifacts.includes(a.id));
  return (
    <aside className="stage-panel" ref={ref} tabIndex={-1} aria-label={`Stage details: ${stage.name}`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="sp-head">
        <div>
          <p className="eyebrow">
            {stage.number ? `Stage ${stage.number} · ` : ""}
            {humanize(stage.phaseId)}
          </p>
          <h2>{stage.name}</h2>
          <p className="mono tiny muted">{stage.slug}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close stage details">
          <Icon name="close" />
        </button>
      </div>
      <div className={`sp-state st-${stage.state}`}>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <p>{meta.describe}</p>
        <p className="mono tiny">
          Recorded: <code>{stage.rawState}</code> <SourceLink source={stage.source} />
        </p>
      </div>
      {stage.attention.length > 0 && (
        <ul className="sp-attention">
          {stage.attention.map((a, n) => (
            <li key={n}>
              <Icon name="warning" size={14} />
              <span>{a.message}</span>
              {a.source && <SourceLink source={a.source} />}
            </li>
          ))}
        </ul>
      )}
      <dl className="sp-facts">
        {stage.leadAgent && (
          <div>
            <dt>Lead</dt>
            <dd>{humanize(stage.leadAgent.replace(/^aidlc-/, "").replace(/-agent$/, ""))}</dd>
          </div>
        )}
        {stage.supportAgents.length > 0 && (
          <div>
            <dt>Support</dt>
            <dd>{stage.supportAgents.map((a) => humanize(a.replace(/^aidlc-/, "").replace(/-agent$/, ""))).join(", ")}</dd>
          </div>
        )}
        <div>
          <dt>Started</dt>
          <dd title={absTime(stage.startedAt)}>{stage.startedAt ? relTime(stage.startedAt) : "not recorded"}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd title={absTime(stage.completedAt)}>{stage.completedAt ? relTime(stage.completedAt) : "—"}</dd>
        </div>
        {stage.revisionCount > 0 && (
          <div>
            <dt>Revisions</dt>
            <dd>{stage.revisionCount}</dd>
          </div>
        )}
        {stage.custom && (
          <div>
            <dt>Origin</dt>
            <dd>Added by a plugin</dd>
          </div>
        )}
        {stage.definitionMissing && (
          <div>
            <dt>Definition</dt>
            <dd>Not in the selected installation (custom, renamed, or from a removed plugin)</dd>
          </div>
        )}
      </dl>
      {stage.description && <p className="sp-desc">{stage.description}</p>}

      <h3 className="h-small">Artifacts</h3>
      {artifacts.length === 0 ? (
        <p className="muted small">No files in this stage's folder.</p>
      ) : (
        <ul className="sp-artifacts">
          {artifacts.map((a) => (
            <li key={a.id}>
              <button className="artifact-link" onClick={() => onOpenArtifact(a.path)}>
                <Icon name="file" size={14} /> <span>{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {decisions.length > 0 && (
        <>
          <h3 className="h-small">Decisions</h3>
          <ul className="sp-decisions">
            {decisions.map((d) => (
              <li key={d.id}>
                <span className={`dk dk-${d.kind}`}>{d.kind === "question" ? "Q" : d.kind === "answer" ? "A" : d.kind.startsWith("gate") ? "G" : "•"}</span>
                <div>
                  <p>{d.title}</p>
                  {d.choice && <p className="muted small">→ {d.choice}</p>}
                  {d.kind === "question" && d.answerState !== "answered" && <p className="warn-text small">{d.answerState === "unanswered" ? "No answer recorded yet" : "Closed without a recorded answer"}</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="h-small">Recorded events</h3>
      <p className="muted small">{events.length} audit event(s) name this stage.</p>
    </aside>
  );
}
