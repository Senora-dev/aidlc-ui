import type { ArtifactContent, IntentDetail, RawBlock, WorkspaceListEntry, WorkspaceSnapshot } from "../../src/shared/model";

const token = document.querySelector<HTMLMetaElement>('meta[name="aidlc-ui-token"]')?.content ?? "";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "x-aidlc-ui-token": token, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Cannot reach the local aidlc-ui service. Is it still running?", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  session: () => call<{ version: string; demoAvailable: boolean; workspaces: WorkspaceListEntry[] }>("/api/session"),
  addWorkspace: (path: string) => call<WorkspaceListEntry & { note?: string | null }>("/api/workspaces", { method: "POST", body: JSON.stringify({ path }) }),
  removeWorkspace: (id: string) => call<{ ok: true }>(`/api/workspaces/${enc(id)}`, { method: "DELETE" }),
  openDemo: () => call<WorkspaceListEntry>("/api/demo", { method: "POST" }),
  snapshot: (id: string) => call<WorkspaceSnapshot>(`/api/workspaces/${enc(id)}`),
  refresh: (id: string) => call<WorkspaceSnapshot>(`/api/workspaces/${enc(id)}/refresh`, { method: "POST" }),
  selectInstallation: (id: string, harness: string | null) =>
    call<WorkspaceSnapshot>(`/api/workspaces/${enc(id)}/installation`, { method: "POST", body: JSON.stringify({ harness }) }),
  intent: (id: string, space: string, dir: string) => call<IntentDetail>(`/api/workspaces/${enc(id)}/intents/${enc(space)}/${enc(dir)}`),
  file: (id: string, path: string) => call<ArtifactContent>(`/api/workspaces/${enc(id)}/file?path=${enc(path)}`),
  block: (id: string, path: string, block?: number) =>
    call<RawBlock>(`/api/workspaces/${enc(id)}/block?path=${enc(path)}${block !== undefined ? `&block=${block}` : ""}`),
};

export type LiveEvent = { id: string; revision: number; refreshedAt: string; dataStatus: string; lastError: string | null };

/** Server-sent events with automatic reconnect. */
export function subscribe(onSnapshot: (e: LiveEvent) => void, onStatus: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry: number | undefined;
  const open = () => {
    es = new EventSource(`/api/events?token=${enc(token)}`);
    es.addEventListener("hello", () => onStatus(true));
    es.addEventListener("ping", () => onStatus(true));
    es.addEventListener("snapshot", (ev) => {
      try {
        onSnapshot(JSON.parse((ev as MessageEvent).data));
      } catch {
        /* ignore malformed */
      }
    });
    es.onerror = () => {
      onStatus(false);
      es?.close();
      if (!closed) retry = window.setTimeout(open, 3000);
    };
  };
  open();
  return () => {
    closed = true;
    window.clearTimeout(retry);
    es?.close();
  };
}
