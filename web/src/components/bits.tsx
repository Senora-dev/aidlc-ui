import type React from "react";
import type { CompatIssue, DataStatus, SourceRef } from "../../../src/shared/model";
import { Icon } from "./Icon";
import { useSourceViewer } from "./SourceViewer";

export function Badge({ tone, children, title }: { tone: string; children: React.ReactNode; title?: string }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function ProgressRing({ value, tone, size = 40 }: { value: number | null; tone: string; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <svg className={`ring tone-${tone}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
      {value !== null && <circle cx={size / 2} cy={size / 2} r={r} className="ring-value" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
    </svg>
  );
}

export function ProgressBar({ completed, planned, inProgress }: { completed: number; planned: number; inProgress: number }) {
  const pct = planned ? (completed / planned) * 100 : 0;
  const ip = planned ? (inProgress / planned) * 100 : 0;
  return (
    <div className="pbar" role="img" aria-label={`${completed} of ${planned} planned stages completed`}>
      <span className="pbar-done" style={{ width: `${pct}%` }} />
      <span className="pbar-ip" style={{ width: `${ip}%` }} />
    </div>
  );
}

export function SourceLink({ source, label = "Source" }: { source: SourceRef; label?: string }) {
  const open = useSourceViewer();
  return (
    <button className="source-link" onClick={() => open(source)} title={`${source.path}${source.block !== undefined ? ` · block ${source.block}` : ""}${source.line ? ` · line ${source.line}` : ""}`}>
      <Icon name="code" size={13} /> {label}
    </button>
  );
}

export function Issues({ issues }: { issues: CompatIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={n} className={`issue issue-${i.severity}`}>
          <Icon name={i.severity === "info" ? "info" : "warning"} />
          <div>
            <p>{i.message}</p>
            {i.action && <p className="issue-action">{i.action}</p>}
            {i.source && <SourceLink source={i.source} label={i.source.path} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DataStatusNote({ status }: { status: DataStatus }) {
  const text: Record<DataStatus, string | null> = {
    ok: null,
    empty: "Nothing recorded yet.",
    missing: "Expected records are missing in this checkout.",
    unsupported: "Recorded in a format this adapter does not support. Not shown as valid.",
    stale: "Showing the last successful read. The latest refresh failed.",
    error: "Records could not be read.",
  };
  const t = text[status];
  return t ? <span className={`data-status ds-${status}`}>{t}</span> : null;
}

export function Empty({ icon = "sparkle", title, children }: { icon?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
