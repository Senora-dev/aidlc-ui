import { useState } from "react";
import type { WorkspaceListEntry } from "../../../src/shared/model";
import { api } from "../api";
import { COMPAT, relTime } from "../format";
import { href, navigate } from "../router";
import { Icon } from "./Icon";
import { Badge } from "./bits";

export function Onboarding({ workspaces, demoAvailable, onChanged }: { workspaces: WorkspaceListEntry[]; demoAvailable: boolean; onChanged: () => Promise<unknown> }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ws = await api.addWorkspace(path.trim());
      await onChanged();
      navigate(href({ name: "workspace", ws: ws.id }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setBusy(true);
    try {
      const ws = await api.openDemo();
      await onChanged();
      navigate(href({ name: "workspace", ws: ws.id }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await api.removeWorkspace(id);
    await onChanged();
  };

  return (
    <div className="onboarding">
      <section className="hero">
        <p className="eyebrow">Independent community project</p>
        <h1>
          See your AI-DLC work <em>at a glance.</em>
        </h1>
        <p className="lede">
          aidlc-ui attaches to the AI-DLC installation you already use. It reads your intents, stages, decisions and artifacts, read-only and on your machine. No
          AWS credentials, API keys, sign-up or migration.
        </p>
        <HeroGraphic />
      </section>

      <section className="panel connect-panel" aria-labelledby="connect-title">
        <h2 id="connect-title">Connect a workspace</h2>
        <p className="muted">
          Enter the absolute path of a project folder that contains <code>aidlc/</code>. You can also run <code>aidlc-ui</code> from inside the project folder.
        </p>
        <form onSubmit={connect} className="connect-form">
          <label htmlFor="ws-path" className="sr-only">
            Workspace path
          </label>
          <input id="ws-path" className="input mono" placeholder="/Users/you/projects/my-app" value={path} onChange={(e) => setPath(e.target.value)} autoComplete="off" spellCheck={false} />
          <button className="btn primary" disabled={busy || !path.trim()}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </form>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {demoAvailable && (
          <div className="demo-cta">
            <div>
              <h3>No AI-DLC project handy?</h3>
              <p className="muted">Explore a clearly labelled demo workspace filled with synthetic sample data.</p>
            </div>
            <button className="btn" onClick={demo} disabled={busy}>
              <Icon name="sparkle" /> Explore the demo
            </button>
          </div>
        )}
      </section>

      {workspaces.length > 0 && (
        <section className="panel" aria-labelledby="known-title">
          <h2 id="known-title">Connected workspaces</h2>
          <ul className="ws-list">
            {workspaces.map((w) => (
              <li key={w.id}>
                <a href={href({ name: "workspace", ws: w.id })} className="ws-row">
                  <span className="ws-row-main">
                    <strong>{w.name}</strong>
                    <span className="mono muted small">{w.demo ? "bundled synthetic data" : w.root}</span>
                  </span>
                  <Badge tone={COMPAT[w.level].tone}>{COMPAT[w.level].label}</Badge>
                  <span className="muted small">
                    {w.intents} intent{w.intents === 1 ? "" : "s"} · {w.lastError ? "refresh issue" : `read ${relTime(w.lastSuccessAt)}`}
                  </span>
                </a>
                <button className="icon-btn" onClick={() => remove(w.id)} aria-label={`Disconnect ${w.name}`} title="Disconnect (forgets it in aidlc-ui only)">
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HeroGraphic() {
  const nodes = [
    { x: 30, s: "done" },
    { x: 90, s: "done" },
    { x: 150, s: "done" },
    { x: 210, s: "gate" },
    { x: 270, s: "pending" },
    { x: 330, s: "pending" },
  ];
  return (
    <svg className="hero-graphic" viewBox="0 0 360 70" aria-hidden="true">
      <line x1="30" y1="35" x2="330" y2="35" className="hg-track" />
      <line x1="30" y1="35" x2="210" y2="35" className="hg-done" />
      {nodes.map((n, i) => (
        <g key={i} className={`hg-node hg-${n.s}`} style={{ animationDelay: `${i * 90}ms` }}>
          <circle cx={n.x} cy={35} r={n.s === "gate" ? 12 : 9} />
          {n.s === "done" && <path d={`M${n.x - 4} 35l3 3 5-6`} />}
        </g>
      ))}
    </svg>
  );
}
