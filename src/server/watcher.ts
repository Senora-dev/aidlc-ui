/**
 * Change detection. File-system events are treated only as *refresh signals*:
 * they are debounced, and a periodic polling pass (cheap stat signature) runs
 * as a fallback for platforms or filesystems where fs.watch is unreliable.
 */
import { watch, type FSWatcher, promises as fsp } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface WatchHandle {
  close(): void;
  mode(): "events+polling" | "polling";
}

export function watchWorkspace(root: string, onSignal: (reason: string) => void, opts: { debounceMs?: number; pollMs?: number } = {}): WatchHandle {
  const debounceMs = opts.debounceMs ?? 300;
  const pollMs = opts.pollMs ?? 4000;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  const watchers: FSWatcher[] = [];
  let eventsOk = false;

  const fire = (reason: string) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onSignal(reason);
    }, debounceMs);
  };

  const tryWatch = (dir: string, recursive: boolean) => {
    try {
      const w = watch(dir, { recursive, persistent: false }, (_event, file) => {
        const f = String(file ?? "");
        // Ignore engine-transient folders; they change constantly and are not read.
        if (/(^|[\\/])\.aidlc-(engine|sessions|sensors)([\\/]|$)/.test(f)) return;
        fire(`fs:${f}`);
      });
      w.on("error", () => {
        eventsOk = false;
      });
      watchers.push(w);
      eventsOk = true;
    } catch {
      /* polling covers it */
    }
  };

  tryWatch(path.join(root, "aidlc"), true);
  tryWatch(root, false); // notices aidlc/ or a harness dir appearing

  let lastSig: string | null = null;
  const poll = async () => {
    if (closed) return;
    try {
      const sig = await signature(root);
      if (lastSig !== null && sig !== lastSig) fire("poll");
      lastSig = sig;
    } catch {
      /* transient */
    }
    if (!closed) pollTimer = setTimeout(poll, pollMs);
  };
  let pollTimer: NodeJS.Timeout = setTimeout(poll, 50);

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      clearTimeout(pollTimer);
      for (const w of watchers) w.close();
    },
    mode: () => (eventsOk ? "events+polling" : "polling"),
  };
}

/** Stat signature of the durable records aidlc-ui reads. */
export async function signature(root: string): Promise<string> {
  const h = crypto.createHash("sha1");
  const add = async (p: string) => {
    try {
      const st = await fsp.stat(p);
      h.update(`${p}:${st.size}:${st.mtimeMs}\n`);
    } catch {
      h.update(`${p}:-\n`);
    }
  };
  const ls = async (p: string) => {
    try {
      return await fsp.readdir(p, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const e of await ls(root)) {
    if (e.isDirectory() && e.name.startsWith(".") && e.name !== ".git") await add(path.join(root, e.name, "tools", "data", "aidlc-stamp.json"));
  }
  const spaces = path.join(root, "aidlc", "spaces");
  for (const sp of await ls(spaces)) {
    if (!sp.isDirectory()) continue;
    const intents = path.join(spaces, sp.name, "intents");
    await add(path.join(intents, "intents.json"));
    for (const it of await ls(intents)) {
      if (!it.isDirectory() || it.name.startsWith(".")) continue;
      const rec = path.join(intents, it.name);
      await add(path.join(rec, "aidlc-state.md"));
      for (const sh of await ls(path.join(rec, "audit"))) await add(path.join(rec, "audit", sh.name));
      // Stage folders: one level of phase dirs + stage dirs (artifact presence).
      for (const ph of await ls(rec)) {
        if (!ph.isDirectory() || ph.name.startsWith(".") || ph.name === "audit") continue;
        for (const st of await ls(path.join(rec, ph.name))) {
          if (st.isDirectory()) for (const f of await ls(path.join(rec, ph.name, st.name))) await add(path.join(rec, ph.name, st.name, f.name));
        }
      }
    }
  }
  return h.digest("hex");
}
