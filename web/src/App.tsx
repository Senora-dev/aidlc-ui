import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IntentDetail, WorkspaceListEntry, WorkspaceSnapshot } from "../../src/shared/model";
import { api, subscribe } from "./api";
import { href, navigate, useRoute } from "./router";
import { Onboarding } from "./components/Onboarding";
import { Overview } from "./components/Overview";
import { Connection } from "./components/Connection";
import { IntentView } from "./components/IntentView";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { SourceViewerProvider } from "./components/SourceViewer";
import { Footer } from "./components/Footer";

export interface Live {
  connected: boolean;
  lastEventAt: number | null;
}

export function App() {
  const route = useRoute();
  const [session, setSession] = useState<{ version: string; demoAvailable: boolean } | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceListEntry[] | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [intent, setIntent] = useState<IntentDetail | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [live, setLive] = useState<Live>({ connected: false, lastEventAt: null });
  const [navOpen, setNavOpen] = useState(false);
  const routeRef = useRef(route);
  routeRef.current = route;

  const loadSession = useCallback(async () => {
    try {
      const s = await api.session();
      setSession({ version: s.version, demoAvailable: s.demoAvailable });
      setWorkspaces(s.workspaces);
      return s.workspaces;
    } catch (err) {
      setSnapError((err as Error).message);
      setWorkspaces([]);
      return [];
    }
  }, []);

  useEffect(() => {
    void loadSession().then((list) => {
      // Single workspace and no route: go straight to it.
      if (routeRef.current.name === "home" && list.length === 1) navigate(href({ name: "workspace", ws: list[0].id }), true);
    });
  }, [loadSession]);

  const wsId = route.ws ?? null;
  const loadSnapshot = useCallback(async (id: string) => {
    try {
      const s = await api.snapshot(id);
      setSnapshot(s);
      setSnapError(null);
    } catch (err) {
      setSnapError((err as Error).message);
    }
  }, []);

  const loadIntent = useCallback(async (id: string, space: string, dir: string) => {
    try {
      const detail = await api.intent(id, space, dir);
      const r = routeRef.current;
      // Ignore late responses for a route the user has already left.
      if (r.ws !== id || r.space !== space || r.intent !== dir) return;
      setIntent(detail);
      setIntentError(null);
    } catch (err) {
      setIntentError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (wsId) void loadSnapshot(wsId);
    else setSnapshot(null);
  }, [wsId, loadSnapshot]);

  useEffect(() => {
    if (route.name === "intent" && wsId && route.space && route.intent) {
      if (intent && (intent.space !== route.space || intent.dirName !== route.intent)) setIntent(null);
      void loadIntent(wsId, route.space, route.intent);
    } else setIntent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, wsId, route.space, route.intent, loadIntent]);

  useEffect(() => {
    return subscribe(
      (e) => {
        setLive({ connected: true, lastEventAt: Date.now() });
        const r = routeRef.current;
        void loadSession();
        if (r.ws === e.id) {
          void loadSnapshot(e.id);
          if (r.name === "intent" && r.space && r.intent) void loadIntent(e.id, r.space, r.intent);
        }
      },
      (connected) => setLive((l) => ({ ...l, connected })),
    );
  }, [loadSession, loadSnapshot, loadIntent]);

  useEffect(() => setNavOpen(false), [route.name, route.ws, route.space, route.intent]);

  const refresh = async () => {
    if (!wsId) return;
    try {
      setSnapshot(await api.refresh(wsId));
      if (route.name === "intent" && route.space && route.intent) await loadIntent(wsId, route.space, route.intent);
    } catch (err) {
      setSnapError((err as Error).message);
    }
  };

  const current = snapshot && snapshot.id === wsId ? snapshot : null;
  let main: React.ReactElement;
  if (workspaces === null) main = <Loading label="Starting aidlc-ui…" />;
  else if (route.name === "home" || !wsId) main = <Onboarding workspaces={workspaces} demoAvailable={session?.demoAvailable ?? false} onChanged={loadSession} />;
  else if (!current) main = snapError ? <ErrorState title="Workspace unavailable" message={snapError} /> : <Loading label="Reading workspace records…" />;
  else if (route.name === "connection") main = <Connection snapshot={current} onChanged={setSnapshot} />;
  else if (route.name === "intent")
    main = intent && intent.space === route.space && intent.dirName === route.intent ? (
      <IntentView key={`${intent.space}/${intent.dirName}`} ws={current} intent={intent} route={route} />
    ) : intentError ? (
      <ErrorState title="Intent unavailable" message={intentError} />
    ) : (
      <Loading label="Reading intent records…" />
    );
  else main = <Overview snapshot={current} />;

  const showSidebar = Boolean(current) && route.name !== "home";
  return (
    <SourceViewerProvider wsId={wsId}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className={`app ${showSidebar ? "with-sidebar" : ""} ${current?.demo ? "is-demo" : ""}`}>
        <TopBar snapshot={current} workspaces={workspaces ?? []} live={live} onRefresh={refresh} onMenu={() => setNavOpen((v) => !v)} showMenu={showSidebar} />
        {current?.demo && (
          <div className="demo-banner" role="note">
            <strong>Demo mode</strong> Synthetic sample data, not a real workspace.
          </div>
        )}
        <div className="body">
          {showSidebar && current && <Sidebar snapshot={current} route={route} open={navOpen} onClose={() => setNavOpen(false)} />}
          <main id="main" className="main" tabIndex={-1}>
            {main}
            <Footer version={session?.version ?? null} />
          </main>
        </div>
      </div>
    </SourceViewerProvider>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <div className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  return (
    <div className="state-panel error" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {children}
    </div>
  );
}
