/**
 * Optional probe of the `aidlc` command on PATH.
 *
 * `aidlc version` is a documented public command ("Print binary and runtime
 * versions"). Verified on 2.10.0 / 2.11.4 / 2.11.5-preview to write no files.
 * It is run with an argument array (no shell), in a neutral working directory
 * (never the workspace), with a timeout and bounded output, and its output is
 * parsed strictly. Anything unexpected is reported as "not recognised".
 */
import { execFile } from "node:child_process";
import os from "node:os";
import type { CliProbe } from "../shared/model.js";

let cached: { at: number; value: CliProbe } | null = null;

export async function probeCli(enabled: boolean): Promise<CliProbe> {
  if (!enabled) return { attempted: false, found: false, binaryVersion: null, runtimeVersion: null, detail: "Not checked" };
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = await new Promise<CliProbe>((resolve) => {
    execFile(
      process.platform === "win32" ? "aidlc.exe" : "aidlc",
      ["version"],
      { cwd: os.tmpdir(), timeout: 4000, maxBuffer: 64 * 1024, windowsHide: true, env: { ...process.env, AIDLC_OFFLINE: "1", NO_COLOR: "1" } },
      (err, stdout) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ attempted: true, found: false, binaryVersion: null, runtimeVersion: null, detail: "No aidlc command on PATH" });
          return;
        }
        const m = /^aidlc ([0-9][0-9A-Za-z.+-]*) \(runtime ([0-9][0-9A-Za-z.+-]*)\)\s*$/m.exec(String(stdout ?? ""));
        if (!m) {
          resolve({ attempted: true, found: false, binaryVersion: null, runtimeVersion: null, detail: err ? `aidlc version failed: ${err.message.slice(0, 120)}` : "An aidlc command exists but its version output was not recognised (it may be a different tool)" });
          return;
        }
        resolve({ attempted: true, found: true, binaryVersion: m[1], runtimeVersion: m[2], detail: `aidlc ${m[1]} (runtime ${m[2]})` });
      },
    );
  });
  cached = { at: Date.now(), value };
  return value;
}
