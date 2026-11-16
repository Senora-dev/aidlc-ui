import { useMemo, useState } from "react";
import type { DecisionEntry, IntentDetail } from "../../../src/shared/model";
import { absTime, humanize } from "../format";
import { Icon } from "./Icon";
import { Badge, Empty, SourceLink } from "./bits";

const KIND: Record<DecisionEntry["kind"], { label: string; tone: string; icon: string }> = {
  question: { label: "Question", tone: "active", icon: "question" },
  answer: { label: "Answer", tone: "done", icon: "chat" },
  "gate-approved": { label: "Gate approved", tone: "done", icon: "check" },
  "gate-rejected": { label: "Changes requested", tone: "revise", icon: "revise" },
  "gate-opened": { label: "Gate opened", tone: "gate", icon: "gate" },
  "plan-approval": { label: "Plan approval", tone: "done", icon: "check" },
  review: { label: "Review", tone: "muted", icon: "eye" },
  other: { label: "Decision", tone: "muted", icon: "info" },
};

export function Decisions({ intent, onStage }: { intent: IntentDetail; onStage: (slug: string) => void }) {
  const [showSystem, setShowSystem] = useState(false);
  const stageName = useMemo(() => new Map(intent.phases.flatMap((p) => p.stages.map((s) => [s.slug, s.name] as const))), [intent.phases]);
  const items = intent.decisions.filter((d) => showSystem || (d.kind !== "gate-opened" && d.kind !== "review"));
  const byId = new Map(intent.decisions.map((d) => [d.id, d]));

  if (!intent.decisions.length)
    return (
      <Empty icon="chat" title="No decisions recorded">
        <p>{intent.shards.length ? "The audit trail holds no questions, answers or gate outcomes yet." : "This intent has no audit trail in this checkout, so decisions are unavailable."}</p>
      </Empty>
    );

  // Group consecutive entries by stage, preserving recorded order.
  const groups: Array<{ stage: string | null; items: DecisionEntry[] }> = [];
  for (const d of items) {
    const last = groups[groups.length - 1];
    if (last && last.stage === d.stage) last.items.push(d);
    else groups.push({ stage: d.stage, items: [d] });
  }

  return (
    <div className="decisions">
      <div className="wf-toolbar">
        <p className="muted small">
          Exactly as recorded in the audit trail, oldest first. aidlc-ui pairs answers with the questions logged before them in the same stage (or by id when the record
          names one). It never fills in a missing answer or approval.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> Show gate openings and reviews
        </label>
      </div>
      {groups.map((g, gi) => (
        <section key={gi} className="dgroup">
          <h3 className="dgroup-title">
            {g.stage ? (
              <button className="linkish" onClick={() => onStage(g.stage!)}>
                {stageName.get(g.stage) ?? humanize(g.stage)}
              </button>
            ) : (
              "Workspace-level"
            )}
          </h3>
          <ol className="dlist">
            {g.items.map((d) => (
              <DecisionCard key={d.id} d={d} answer={d.answeredBy ? byId.get(d.answeredBy) ?? null : null} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function DecisionCard({ d, answer }: { d: DecisionEntry; answer: DecisionEntry | null }) {
  const k = KIND[d.kind];
  const chosen = (answer?.choice ?? "").toLowerCase();
  return (
    <li className={`dcard dcard-${d.kind}`}>
      <div className="dcard-rail">
        <span className={`dcard-icon tone-${k.tone}`}>
          <Icon name={k.icon} size={14} />
        </span>
      </div>
      <div className="dcard-body">
        <div className="dcard-head">
          <Badge tone={k.tone}>{k.label}</Badge>
          <time className="muted small" dateTime={d.timestamp ?? undefined}>
            {absTime(d.timestamp)}
          </time>
          {d.unordered && (
            <span className="unordered" title="Another writer (clone) recorded an event in the same second. Their relative order is unknown.">
              order uncertain
            </span>
          )}
          <SourceLink source={d.source} />
        </div>
        <p className="dcard-title">{d.title}</p>
        {d.options.length > 0 && (
          <ul className="options">
            {d.options.map((o) => {
              const clean = o.replace(/\s*\(Recommended\)\s*$/i, "");
              const isRec = d.recommended ? clean === d.recommended : /\(Recommended\)/i.test(o);
              const isChosen = chosen && clean.toLowerCase() === chosen;
              return (
                <li key={o} className={`${isChosen ? "chosen" : ""}`}>
                  {isChosen && <Icon name="check" size={13} />} {clean}
                  {isRec && <span className="rec">recommended</span>}
                </li>
              );
            })}
          </ul>
        )}
        {d.kind === "question" && (
          <p className={`answer-state as-${d.answerState}`}>
            {d.answerState === "answered" && answer ? (
              <>
                Answered{answer.choice ? <>: <strong>{answer.choice}</strong></> : <> by the recorded "{answer.title}" entry</>}
              </>
            ) : d.answerState === "unanswered" ? (
              "No answer recorded yet"
            ) : (
              "No answer was recorded before the stage moved on"
            )}
          </p>
        )}
        {d.kind !== "question" && d.choice && (
          <p className="dcard-choice">
            <span className="muted small">Recorded choice</span> {d.choice}
          </p>
        )}
        {d.personReply && (
          <blockquote className="reply">
            <span className="muted small">Person's words, as recorded</span>
            <p>{d.personReply}</p>
          </blockquote>
        )}
        {d.gitName && (
          <p className="muted small attribution">
            <Icon name="user" size={13} /> {d.gitName} <span className="tiny">(git user.name as recorded, not a verified identity)</span>
          </p>
        )}
      </div>
    </li>
  );
}
