/**
 * aidlc-ui preferences: registered workspaces and per-workspace choices.
 *
 * Stored ONLY in aidlc-ui's own config directory, never inside a workspace
 * or any upstream-managed file:
 *   $AIDLC_UI_CONFIG_DIR, else
 *   macOS:   ~/Library/Application Support/aidlc-ui
 *   Windows: %APPDATA%\aidlc-ui
 *   other:   $XDG_CONFIG_HOME/aidlc-ui or ~/.config/aidlc-ui
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface WorkspacePref {
  id: string;
  root: string;
  name: string;
  harness: string | null;
  addedAt: string;
}

export interface Prefs {
  version: 1;
  workspaces: WorkspacePref[];
}

export function configDir(): string {
  if (process.env.AIDLC_UI_CONFIG_DIR) return path.resolve(process.env.AIDLC_UI_CONFIG_DIR);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "aidlc-ui");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "aidlc-ui");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "aidlc-ui");
}

export class PrefStore {
  private prefs: Prefs = { version: 1, workspaces: [] };
  constructor(private readonly file = path.join(configDir(), "config.json"), private readonly persist = true) {}

  async load(): Promise<Prefs> {
    if (!this.persist) return this.prefs;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (raw && Array.isArray(raw.workspaces)) {
        this.prefs = {
          version: 1,
          workspaces: raw.workspaces.filter((w: WorkspacePref) => typeof w?.root === "string" && path.isAbsolute(w.root)).map((w: WorkspacePref) => ({
            id: typeof w.id === "string" ? w.id : idFor(w.root),
            root: w.root,
            name: typeof w.name === "string" ? w.name : path.basename(w.root),
            harness: typeof w.harness === "string" ? w.harness : null,
            addedAt: typeof w.addedAt === "string" ? w.addedAt : new Date().toISOString(),
          })),
        };
      }
    } catch {
      /* first run or unreadable: start empty, never crash */
    }
    return this.prefs;
  }

  get(): Prefs {
    return this.prefs;
  }

  async upsert(root: string, name?: string): Promise<WorkspacePref> {
    const existing = this.prefs.workspaces.find((w) => w.root === root);
    if (existing) return existing;
    const pref: WorkspacePref = { id: idFor(root), root, name: name ?? path.basename(root), harness: null, addedAt: new Date().toISOString() };
    this.prefs.workspaces.push(pref);
    await this.save();
    return pref;
  }

  async remove(id: string): Promise<void> {
    this.prefs.workspaces = this.prefs.workspaces.filter((w) => w.id !== id);
    await this.save();
  }

  async setHarness(id: string, harness: string | null): Promise<void> {
    const w = this.prefs.workspaces.find((x) => x.id === id);
    if (w) {
      w.harness = harness;
      await this.save();
    }
  }

  private async save(): Promise<void> {
    if (!this.persist) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.prefs, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
}

export function idFor(root: string): string {
  return crypto.createHash("sha256").update(root).digest("hex").slice(0, 12);
}
