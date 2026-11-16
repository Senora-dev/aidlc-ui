import type { WorkspaceSnapshot } from "../../../src/shared/model";
import { LIFECYCLE } from "../format";
import { href, type Route } from "../router";
import { Icon } from "./Icon";
import { ProgressRing } from "./bits";

export function Sidebar({ snapshot, route, open, onClose }: { snapshot: WorkspaceSnapshot; route: Route; open: boolean; onClose: () => void }) {
  return (
    <>
      <div className={`scrim ${open ? "show" : ""}`} onClick={onClose} aria-hidden="true" />
      <nav className={`sidebar ${open ? "open" : ""}`} aria-label="Spaces and intents">
        <a className={`side-link ${route.name === "workspace" ? "current" : ""}`} href={href({ name: "workspace", ws: snapshot.id })} aria-current={route.name === "workspace" ? "page" : undefined}>
          <Icon name="layers" /> Overview
        </a>
        <a className={`side-link ${route.name === "connection" ? "current" : ""}`} href={href({ name: "connection", ws: snapshot.id })} aria-current={route.name === "connection" ? "page" : undefined}>
          <Icon name="plug" /> Connection
        </a>
        {snapshot.spaces.map((sp) => (
          <div className="side-space" key={sp.name}>
            <div className="side-space-title">
              <span>{sp.name}</span>
              {sp.active && <span className="tiny-tag" title="Your active space (per-user cursor)">active</span>}
            </div>
            {sp.intents.length === 0 && <p className="side-empty">No intents recorded</p>}
            <ul>
              {sp.intents.map((i) => {
                const current = route.name === "intent" && route.space === sp.name && route.intent === i.dirName;
                const lc = LIFECYCLE[i.lifecycle];
                return (
                  <li key={i.dirName}>
                    <a className={`side-intent ${current ? "current" : ""}`} href={href({ name: "intent", ws: snapshot.id, space: sp.name, intent: i.dirName, tab: route.tab })} aria-current={current ? "page" : undefined}>
                      <ProgressRing value={i.progress ? i.progress.completed / Math.max(1, i.progress.planned) : null} tone={lc.tone} size={22} />
                      <span className="side-intent-text">
                        <span className="side-intent-name">{i.label}</span>
                        <span className="side-intent-meta">
                          {lc.label}
                          {i.pending.length > 0 && <span className="pending-dot" title={`${i.pending.length} pending decision(s)`}> · {i.pending.length} waiting</span>}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
