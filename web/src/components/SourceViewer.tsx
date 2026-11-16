import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { SourceRef } from "../../../src/shared/model";
import { api } from "../api";
import { Icon } from "./Icon";

const Ctx = createContext<(s: SourceRef) => void>(() => undefined);
export const useSourceViewer = () => useContext(Ctx);

/** Modal that shows the exact upstream record a value came from (raw text). */
export function SourceViewerProvider({ wsId, children }: { wsId: string | null; children: React.ReactNode }) {
  const [src, setSrc] = useState<SourceRef | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((s: SourceRef) => {
    opener.current = document.activeElement as HTMLElement;
    setSrc(s);
  }, []);

  useEffect(() => {
    if (!src || !wsId) return;
    setText(null);
    setErr(null);
    dialog.current?.showModal();
    const req = src.block !== undefined ? api.block(wsId, src.path, src.block) : api.file(wsId, src.path);
    req
      .then((r) => {
        if ("block" in r) setText(r.text);
        else {
          const lines = r.text.split("\n");
          if (src.line) {
            const start = Math.max(0, src.line - 4);
            setText(lines.slice(start, src.line + 12).map((l, i) => `${String(start + i + 1).padStart(4)}${start + i + 1 === src.line ? " ▸ " : "   "}${l}`).join("\n"));
          } else setText(r.text);
        }
      })
      .catch((e) => setErr((e as Error).message));
  }, [src, wsId]);

  const close = () => {
    dialog.current?.close();
    setSrc(null);
    opener.current?.focus();
  };

  return (
    <Ctx.Provider value={open}>
      {children}
      <dialog ref={dialog} className="source-dialog" onClose={close} onCancel={close} aria-labelledby="source-title">
        <div className="source-head">
          <div>
            <p className="eyebrow">Source record</p>
            <h2 id="source-title" className="mono">
              {src?.path}
              {src?.block !== undefined ? ` · block ${src.block}` : ""}
              {src?.line ? ` · line ${src.line}` : ""}
            </h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {err ? <p className="error-text">{err}</p> : text === null ? <p className="muted">Loading…</p> : <pre className="raw">{text}</pre>}
        <p className="muted small">Read-only view of the upstream record. aidlc-ui never modifies it.</p>
      </dialog>
    </Ctx.Provider>
  );
}
