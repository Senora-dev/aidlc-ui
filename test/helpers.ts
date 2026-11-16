import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanWorkspace } from "../src/adapters/index.js";
import { RootFs } from "../src/server/fsguard.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIX = (name: string) => path.join(ROOT, "test", "fixtures", "upstream", name);

export async function scan(root: string, preferredHarness: string | null = null) {
  return scanWorkspace(new RootFs(root), { preferredHarness, cli: null });
}

/** Copy a fixture into a fresh temp dir so a test can mutate it. */
export async function tempCopy(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `aidlc-ui-${name}-`));
  await fs.cp(FIX(name), dir, { recursive: true });
  return fs.realpath(dir);
}

export async function tempDir(): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "aidlc-ui-t-")));
}

/** Content hash of every file (path + bytes + mode) under a directory. */
export async function treeHash(dir: string): Promise<string> {
  const h = crypto.createHash("sha256");
  const walk = async (d: string) => {
    for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      const st = await fs.lstat(p);
      h.update(`${path.relative(dir, p)}|${st.mode}|${e.isDirectory() ? "d" : e.isSymbolicLink() ? "l" : "f"}\n`);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) h.update(await fs.readFile(p));
    }
  };
  await walk(dir);
  return h.digest("hex");
}

export function intentsOf(r: Awaited<ReturnType<typeof scan>>) {
  return r.snapshot.spaces.flatMap((s) => s.intents);
}
