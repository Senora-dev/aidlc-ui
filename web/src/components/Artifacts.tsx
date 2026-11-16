import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { Artifact, ArtifactContent, IntentDetail } from "../../../src/shared/model";
import { api } from "../api";
import { absTime, bytes, humanize } from "../format";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Empty } from "./bits";

export function Artifacts({ wsId, intent, file, onFile, onStage }: { wsId: string; intent: IntentDetail; file: string | null; onFile: (p: string) => void; onStage: (s: string) => void }) {
  const stageMeta = useMemo(() => new Map(intent.phases.flatMap((p) => p.stages.map((s) => [s.slug, { name: s.name, phase: p.name }] as const))), [intent.phases]);
  // Order artifacts by workflow order (phase, stage), then name.
  const order = useMemo(() => intent.phases.flatMap((p) => p.stages.map((s) => s.slug)), [intent.phases]);
  const sorted = useMemo(
    () =>
      [...intent.artifacts].sort((a, b) => {
        const ia = a.stage ? order.indexOf(a.stage) : 9999;
        const ib = b.stage ? order.indexOf(b.stage) : 9999;
        return (ia < 0 ? 9998 : ia) - (ib < 0 ? 9998 : ib) || rank(a) - rank(b) || a.path.localeCompare(b.path);
      }),
    [intent.artifacts, order],
  );
  const current = sorted.find((a) => a.path === file) ?? null;
  useEffect(() => {
    if (!file && sorted.length && window.matchMedia("(min-width: 900px)").matches) onFile(sorted.find((a) => a.kind === "markdown")?.path ?? sorted[0].path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, sorted.length]);

  if (!sorted.length)
    return (
      <Empty icon="file" title="No artifacts yet">
        <p>No files have been written to this intent's stage folders in this checkout.</p>
      </Empty>
    );

  const groups: Array<{ key: string; label: string; sub: string; items: Artifact[] }> = [];
  for (const a of sorted) {
    const key = a.stage ?? a.phaseDir ?? "other";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const m = a.stage ? stageMeta.get(a.stage) : undefined;
      groups.push((g = { key, label: m?.name ?? humanize(key), sub: m?.phase ?? (a.phaseDir ? humanize(a.phaseDir) : ""), items: [] }));
    }
    g.items.push(a);
  }
  const idx = current ? sorted.indexOf(current) : -1;

  return (
    <div className={`artifacts ${current ? "reading" : ""}`}>
      <nav className="art-nav" aria-label="Artifacts by stage">
        {groups.map((g) => (
          <div key={g.key} className="art-group">
            <p className="art-group-title">
              <span>{g.label}</span>
              <span className="muted tiny">{g.sub}</span>
            </p>
            <ul>
              {g.items.map((a) => (
                <li key={a.id}>
                  <button className={`art-item ${current?.id === a.id ? "current" : ""}`} onClick={() => onFile(a.path)} aria-current={current?.id === a.id ? "true" : undefined}>
                    <Icon name="file" size={14} />
                    <span className="art-name">{a.name}</span>
                    {a.recorded && <span className="rec-dot" title="Write recorded in the audit trail" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <section className="reader" aria-live="polite">
        {current ? (
          <Reader
            key={current.path}
            wsId={wsId}
            artifact={current}
            stageName={current.stage ? stageMeta.get(current.stage)?.name ?? null : null}
            prev={idx > 0 ? sorted[idx - 1] : null}
            next={idx < sorted.length - 1 ? sorted[idx + 1] : null}
            onFile={onFile}
            onStage={onStage}
            all={sorted}
          />
        ) : (
          <Empty icon="file" title="Choose an artifact">
            <p>Select a file to read it.</p>
          </Empty>
        )}
      </section>
    </div>
  );
}

function rank(a: Artifact): number {
  if (a.name.endsWith("-questions.md")) return 2;
  if (a.name === "memory.md") return 3;
  return a.kind === "markdown" ? 0 : 1;
}

function Reader({ wsId, artifact, stageName, prev, next, onFile, onStage, all }: { wsId: string; artifact: Artifact; stageName: string | null; prev: Artifact | null; next: Artifact | null; onFile: (p: string) => void; onStage: (s: string) => void; all: Artifact[] }) {
  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState(artifact.kind !== "markdown");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .file(wsId, artifact.path)
      .then((c) => alive && setContent(c))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [wsId, artifact.path, artifact.modifiedAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "[" && prev) onFile(prev.path);
      if (e.key === "]" && next) onFile(next.path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onFile]);

  const relLink = (target: string) => {
    const base = artifact.path.split("/").slice(0, -1);
    for (const part of target.split("#")[0].split("/")) {
      if (part === "..") base.pop();
      else if (part && part !== ".") base.push(part);
    }
    const resolved = base.join("/");
    const hit = all.find((a) => a.path === resolved);
    if (hit) onFile(hit.path);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  let bodyEl: React.ReactElement;
  if (err) bodyEl = <p className="error-text">{err}</p>;
  else if (!content) bodyEl = <div className="skeleton" aria-label="Loading" />;
  else if (content.kind === "other") bodyEl = <p className="muted">This file is not text. aidlc-ui does not render binary files.</p>;
  else if (!raw && content.kind === "markdown") bodyEl = <Markdown text={content.text} onRelativeLink={relLink} />;
  else bodyEl = <pre className="raw code">{content.kind === "json" ? pretty(content.text) : content.text}</pre>;

  return (
    <article className="reader-inner">
      <header className="reader-head">
        <div className="reader-title">
          {stageName && artifact.stage && (
            <button className="linkish eyebrow" onClick={() => onStage(artifact.stage!)}>
              {stageName}
            </button>
          )}
          <h2>{artifact.name}</h2>
          <p className="mono tiny path-line">
            {artifact.path}{" "}
            <button className="icon-btn tiny-btn" onClick={copy} aria-label="Copy source path" title="Copy source path">
              <Icon name="copy" size={13} />
            </button>
            {copied && <span className="copied">copied</span>}
          </p>
          <p className="muted tiny">
            {content ? bytes(content.size) : ""} · modified {absTime(artifact.modifiedAt)}
            {artifact.recorded ? " · write recorded in audit trail" : ""}
            {content?.truncated ? " · truncated to 2 MB" : ""}
          </p>
        </div>
        <div className="reader-actions">
          {artifact.kind === "markdown" && (
            <div className="seg" role="group" aria-label="View mode">
              <button className={!raw ? "on" : ""} aria-pressed={!raw} onClick={() => setRaw(false)}>
                <Icon name="eye" size={14} /> Rendered
              </button>
              <button className={raw ? "on" : ""} aria-pressed={raw} onClick={() => setRaw(true)}>
                <Icon name="code" size={14} /> Raw
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="reader-body">{bodyEl}</div>
      <footer className="reader-foot">
        <button className="btn ghost" disabled={!prev} onClick={() => prev && onFile(prev.path)}>
          <Icon name="back" size={14} /> {prev ? prev.name : "Start"}
        </button>
        <span className="muted tiny">
          <kbd>[</kbd> <kbd>]</kbd> to move between artifacts
        </span>
        <button className="btn ghost" disabled={!next} onClick={() => next && onFile(next.path)}>
          {next ? next.name : "End"} <Icon name="chevron" size={14} />
        </button>
      </footer>
    </article>
  );
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
