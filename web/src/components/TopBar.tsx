import { useEffect, useState } from "react";
import type { WorkspaceListEntry, WorkspaceSnapshot } from "../../../src/shared/model";
import type { Live } from "../App";
import { absTime, COMPAT, relTime } from "../format";
import { href, navigate } from "../router";
import { Icon } from "./Icon";

export function Logo() {
  return (
    <a className="logo" href="#/" aria-label="aidlc-ui home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--brand)" />
        <circle cx="9" cy="16" r="3" fill="#fff" />
        <circle cx="23" cy="10" r="3" fill="#fff" opacity=".85" />
        <circle cx="23" cy="22" r="3" fill="#fff" opacity=".6" />
        <path d="M11.5 15l9-4M11.5 17l9 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="logo-text">
        aidlc<span>-ui</span>
      </span>
    </a>
  );
}

function useNow(ms = 10_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function LiveStatus({ snapshot, live, onRefresh }: { snapshot: WorkspaceSnapshot; live: Live; onRefresh: () => void }) {
  const now = useNow();
  let tone = "ok";
  let label = "Live";
  let detail = `Last successful refresh ${relTime(snapshot.lastSuccessAt, now)} (${absTime(snapshot.lastSuccessAt)})`;
  if (snapshot.demo) {
    tone = "muted";
    label = "Static demo";
    detail = "Demo data does not change.";
  } else if (!live.connected) {
    tone = "danger";
    label = "Disconnected";
    detail = `Lost connection to the local service. Retrying. ${detail}`;
  } else if (snapshot.dataStatus === "stale" || snapshot.dataStatus === "error") {
    tone = "warn";
    label = "Stale";
    detail = `${snapshot.lastError ?? "Refresh failed"}. ${detail}`;
  } else if (snapshot.lastError) {
    tone = "warn";
    label = "Live · issues";
    detail = `${snapshot.lastError} ${detail}`;
  }
  return (
    <div className={`live live-${tone}`}>
      <span className="live-dot" aria-hidden="true" />
      <span className="live-label">{label}</span>
      <span className="live-time" title={detail}>
        {snapshot.demo ? "" : relTime(snapshot.lastSuccessAt, now)}
      </span>
      <span className="sr-only">{detail}</span>
      {!snapshot.demo && (
        <button className="icon-btn" onClick={onRefresh} title="Refresh now" aria-label="Refresh now">
          <Icon name="refresh" />
        </button>
      )}
    </div>
  );
}

export function TopBar(props: { snapshot: WorkspaceSnapshot | null; workspaces: WorkspaceListEntry[]; live: Live; onRefresh: () => void; onMenu: () => void; showMenu: boolean }) {
  const { snapshot, workspaces } = props;
  const inst = snapshot?.installations.find((i) => i.harnessDir === snapshot.selectedInstallation);
  const compat = snapshot ? COMPAT[snapshot.compatibility.level] : null;
  return (
    <header className="topbar">
      {props.showMenu && (
        <button className="icon-btn menu-btn" onClick={props.onMenu} aria-label="Toggle navigation">
          <Icon name="menu" size={18} />
        </button>
      )}
      <Logo />
      {workspaces.length > 0 && (
        <label className="ws-switch">
          <span className="sr-only">Workspace</span>
          <select
            value={snapshot?.id ?? ""}
            onChange={(e) => navigate(e.target.value ? href({ name: "workspace", ws: e.target.value }) : "#/")}
          >
            {!snapshot && <option value="">Choose a workspace…</option>}
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.demo ? "◆ " : ""}
                {w.name}
              </option>
            ))}
            <option value="">+ Connect another…</option>
          </select>
        </label>
      )}
      <div className="topbar-spacer" />
      {snapshot && compat && (
        <a className={`conn-chip tone-${compat.tone}`} href={href({ name: "connection", ws: snapshot.id })} title="Connection and compatibility details">
          <Icon name="plug" />
          <span className="conn-version">{inst?.frameworkVersion ? `AI-DLC ${inst.frameworkVersion}` : "No installation"}</span>
          <span className="conn-level">{compat.label}</span>
        </a>
      )}
      {snapshot && <LiveStatus snapshot={snapshot} live={props.live} onRefresh={props.onRefresh} />}
    </header>
  );
}
