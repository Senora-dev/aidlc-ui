/**
 * Connected workspaces: holds each workspace's last good snapshot, refreshes
 * it on change signals, retries partially written records, and reports
 * staleness honestly instead of showing broken data as current.
 */
import crypto from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { scanWorkspace } from "../adapters/index.js";
import type { IntentDetail, WorkspaceListEntry, WorkspaceSnapshot } from "../shared/model.js";
import { probeCli } from "./cli-probe.js";
import { RootFs } from "./fsguard.js";
import { watchWorkspace, type WatchHandle } from "./watcher.js";

export interface WorkspaceOptions {
  id: string;
  root: string;
  name: string;
  demo: boolean;
  harness: string | null;
  cliProbe: boolean;
  watch: boolean;
}

type Listener = (id: string, snap: WorkspaceSnapshot) => void;

export class Workspace {
  readonly fs: RootFs;
  snapshot: WorkspaceSnapshot | null = null;
  details = new Map<string, IntentDetail>();
  private hash = "";
  private revision = 0;
  private watcher: WatchHandle | null = null;
  private refreshing: Promise<void> | null = null;
  private again = false;

  constructor(readonly opts: WorkspaceOptions, private readonly listener: Listener) {
    this.fs = new RootFs(opts.root);
  }

  start(): void {
    if (this.opts.watch && !this.opts.demo) this.watcher = watchWorkspace(this.opts.root, () => void this.refresh());
  }

  stop(): void {
    this.watcher?.close();
  }

  /** Coalescing refresh: concurrent signals collapse into one follow-up pass. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.again = false;
        await this.refreshOnce();
      } while (this.again);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshOnce(): Promise<void> {
    const now = new Date().toISOString();
    try {
      await fsp.access(this.opts.root);
    } catch {
      this.markStale(`Workspace folder is not reachable: ${this.opts.root}`, now);
      return;
    }
    const cli = this.opts.demo ? null : await probeCli(this.opts.cliProbe);
    let attempt = 0;
    let lastErr: unknown = null;
    // Partial writes: an engine may be mid-write. Retry a few times when any
    // record reads as an error, then accept what we have (marked as such).
    while (attempt < 4) {
      try {
        const res = await scanWorkspace(this.fs, { preferredHarness: this.opts.harness, cli });
        const hasErrors = res.snapshot.spaces.some((s) => s.intents.some((i) => i.dataStatus === "error") || s.registry.status === "error");
        if (hasErrors && attempt < 3) {
          attempt++;
          await delay(150 * attempt);
          continue;
        }
        const body = JSON.stringify(res.snapshot);
        const detailHash = JSON.stringify([...res.details.values()].map((d) => [d.key, d.events.length, d.artifacts.map((a) => `${a.modifiedAt}:${a.size}`)]));
        const h = crypto.createHash("sha1").update(body).update(detailHash).digest("hex");
        if (h !== this.hash) {
          this.hash = h;
          this.revision++;
        }
        const totalIntents = res.snapshot.spaces.reduce((n, s) => n + s.intents.length, 0);
        this.details = res.details;
        this.snapshot = {
          ...res.snapshot,
          id: this.opts.id,
          name: this.opts.name,
          root: this.opts.root,
          demo: this.opts.demo,
          dataStatus: res.snapshot.compatibility.level === "not-detected" ? "missing" : totalIntents === 0 ? "empty" : "ok",
          refreshedAt: now,
          lastSuccessAt: now,
          lastError: hasErrors ? "Some records could not be read after retries; they are marked in place." : null,
          revision: this.revision,
        };
        this.listener(this.opts.id, this.snapshot);
        return;
      } catch (err) {
        lastErr = err;
        attempt++;
        await delay(150 * attempt);
      }
    }
    this.markStale(`Refresh failed: ${(lastErr as Error)?.message ?? lastErr}`, now);
  }

  private markStale(message: string, now: string): void {
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, dataStatus: "stale", refreshedAt: now, lastError: message };
    } else {
      this.snapshot = {
        modelVersion: 1, id: this.opts.id, name: this.opts.name, root: this.opts.root, demo: this.opts.demo, installations: [], selectedInstallation: null, cli: null,
        compatibility: { level: "not-detected", adapterId: null, adapterLabel: null, summary: message, issues: [{ severity: "error", message }], capabilities: [], testedVersions: [] },
        spaces: [], dataStatus: "error", refreshedAt: now, lastSuccessAt: null, lastError: message, revision: this.revision,
      };
    }
    this.listener(this.opts.id, this.snapshot);
  }

  listEntry(): WorkspaceListEntry {
    const s = this.snapshot;
    return {
      id: this.opts.id,
      name: this.opts.name,
      root: this.opts.root,
      demo: this.opts.demo,
      level: s?.compatibility.level ?? "not-detected",
      intents: s?.spaces.reduce((n, sp) => n + sp.intents.length, 0) ?? 0,
      lastSuccessAt: s?.lastSuccessAt ?? null,
      lastError: s?.lastError ?? null,
    };
  }
}

export class WorkspaceRegistry {
  private readonly items = new Map<string, Workspace>();
  private readonly listeners = new Set<Listener>();

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async add(opts: WorkspaceOptions): Promise<Workspace> {
    const existing = this.items.get(opts.id);
    if (existing) return existing;
    const ws = new Workspace(opts, (id, snap) => this.listeners.forEach((l) => l(id, snap)));
    this.items.set(opts.id, ws);
    await ws.refresh();
    ws.start();
    return ws;
  }

  get(id: string): Workspace | undefined {
    return this.items.get(id);
  }

  list(): Workspace[] {
    return [...this.items.values()];
  }

  remove(id: string): void {
    this.items.get(id)?.stop();
    this.items.delete(id);
  }

  stopAll(): void {
    for (const w of this.items.values()) w.stop();
  }
}

export async function resolveWorkspaceRoot(input: string): Promise<{ root: string; note: string | null }> {
  const abs = path.resolve(input);
  const real = await fsp.realpath(abs);
  const st = await fsp.stat(real);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${input}`);
  // If the user points inside a workspace (e.g. at aidlc/ or a repo below it), walk up to the folder holding aidlc/spaces.
  let cur = real;
  for (let i = 0; i < 8; i++) {
    if (await exists(path.join(cur, "aidlc", "spaces"))) return { root: cur, note: cur === real ? null : `Using the workspace root ${cur}` };
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return { root: real, note: null };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
