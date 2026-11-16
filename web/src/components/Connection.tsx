import { useState } from "react";
import type { WorkspaceSnapshot } from "../../../src/shared/model";
import { api } from "../api";
import { absTime, CAP, COMPAT } from "../format";
import { Icon } from "./Icon";
import { Badge, Issues, SourceLink } from "./bits";

export function Connection({ snapshot, onChanged }: { snapshot: WorkspaceSnapshot; onChanged: (s: WorkspaceSnapshot) => void }) {
  const c = snapshot.compatibility;
  const compat = COMPAT[c.level];
  const [busy, setBusy] = useState(false);
  const choose = async (harness: string) => {
    setBusy(true);
    try {
      onChanged(await api.selectInstallation(snapshot.id, harness));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Connection & compatibility</p>
          <h1>{snapshot.name}</h1>
          <p className="mono muted small path-line">{snapshot.demo ? "Bundled synthetic demo data" : snapshot.root}</p>
        </div>
      </header>

      <section className={`compat-hero tone-${compat.tone}`}>
        <div className="compat-level">
          <Icon name={c.level === "verified" ? "shield" : c.level === "incompatible" ? "warning" : "info"} size={22} />
          <span>{compat.label}</span>
        </div>
        <p>{c.summary}</p>
        <p className="muted small">
          Adapter: <strong>{c.adapterLabel ?? "none"}</strong>
          {c.adapterId ? <span className="mono"> ({c.adapterId})</span> : null} · Last successful read {absTime(snapshot.lastSuccessAt)}
        </p>
      </section>

      <Issues issues={c.issues} />

      <section className="panel">
        <h2 className="h-small">AI-DLC installation{snapshot.installations.length === 1 ? "" : "s"} in this workspace</h2>
        {snapshot.installations.length === 0 ? (
          <p className="muted">No installation stamp (…/tools/data/aidlc-stamp.json) was found. Records are still read, but stage names come from the records alone.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>Harness</th>
                  <th>AI-DLC version</th>
                  <th>Stage definitions</th>
                  <th>
                    <span className="sr-only">Selection</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.installations.map((i) => (
                  <tr key={i.harnessDir}>
                    <td className="mono">{i.harnessDir}</td>
                    <td>{i.productName ?? i.distribution ?? "—"}</td>
                    <td>
                      {i.frameworkVersion ?? "unreadable"} <SourceLink source={i.source} label="stamp" />
                    </td>
                    <td>{i.stageDefinitions || "none"}</td>
                    <td>
                      {snapshot.selectedInstallation === i.harnessDir ? (
                        <Badge tone="done">In use</Badge>
                      ) : (
                        <button className="btn small" disabled={busy} onClick={() => choose(i.harnessDir)}>
                          Use this
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {snapshot.cli && (
          <p className="muted small">
            <Icon name="code" size={13} /> <code>aidlc version</code> on PATH: {snapshot.cli.detail}
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className="h-small">Capabilities</h2>
        <ul className="caps">
          {c.capabilities.map((cap) => (
            <li key={cap.id} className={`cap cap-${cap.status}`}>
              <Badge tone={CAP[cap.status].tone}>{CAP[cap.status].label}</Badge>
              <div>
                <strong>{cap.label}</strong>
                <p className="muted small">{cap.detail}</p>
                {cap.evidence && cap.evidence.length > 0 && <p className="mono tiny">{cap.evidence.join(" · ")}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel two-col">
        <div>
          <h2 className="h-small">Tested upstream versions</h2>
          <ul className="plain">
            {c.testedVersions.map((v) => (
              <li key={v} className="mono">
                {v}
              </li>
            ))}
          </ul>
          <p className="muted small">Other versions are read only if every schema probe passes, and are labelled untested.</p>
        </div>
        <div>
          <h2 className="h-small">What aidlc-ui never does</h2>
          <ul className="plain never">
            <li>Write, migrate or patch your records or installation</li>
            <li>Upgrade, downgrade or reconfigure AI-DLC</li>
            <li>Approve gates or answer questions for you</li>
            <li>Send source, artifacts or workflow metadata anywhere</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
