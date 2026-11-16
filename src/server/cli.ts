/**
 * aidlc-ui command line entry.
 *
 *   aidlc-ui [workspace-path] [options]
 *
 * With no path, the current directory is used (walking up to the folder that
 * holds aidlc/spaces, like git does for .git).
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrefStore } from "./config.js";
import { DEMO_ID, newToken, startServer } from "./server.js";
import { resolveWorkspaceRoot, WorkspaceRegistry } from "./workspaces.js";

const HELP = `aidlc-ui - a visual companion for AWS AI-DLC workflows (read-only)

Usage:
  aidlc-ui [workspace-path] [options]

Options:
  --port <n>         Port to listen on (default 4317; the next free port is used if busy)
  --host <addr>      Loopback address to bind (127.0.0.1 | ::1 | localhost; default 127.0.0.1)
  --demo             Open the synthetic demo workspace (no AI-DLC install needed)
  --add <path>       Register another workspace (repeatable)
  --no-open          Do not open a browser
  --no-cli-probe     Do not run \`aidlc version\` to compare the CLI version
  --no-persist       Do not remember workspaces in aidlc-ui's config
  --version          Print the aidlc-ui version
  -h, --help         Show this help

aidlc-ui never writes to your workspace or your AI-DLC installation.
Independent community project; not an official AWS product.`;

interface Args {
  paths: string[];
  port: number;
  host: string;
  demo: boolean;
  open: boolean;
  cliProbe: boolean;
  persist: boolean;
  dev: boolean;
}

function parseArgs(argv: string[]): Args | "help" | "version" {
  const a: Args = { paths: [], port: 4317, host: "127.0.0.1", demo: false, open: true, cliProbe: true, persist: true, dev: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => {
      const n = argv[++i];
      if (n === undefined) throw new Error(`${v} needs a value`);
      return n;
    };
    if (v === "-h" || v === "--help") return "help";
    else if (v === "--version" || v === "-v") return "version";
    else if (v === "--port") a.port = Number(next());
    else if (v === "--host") a.host = next();
    else if (v === "--demo") a.demo = true;
    else if (v === "--add") a.paths.push(next());
    else if (v === "--no-open") a.open = false;
    else if (v === "--no-cli-probe") a.cliProbe = false;
    else if (v === "--no-persist") a.persist = false;
    else if (v === "--dev") a.dev = true;
    else if (v.startsWith("-")) throw new Error(`Unknown option ${v} (see --help)`);
    else a.paths.unshift(v);
  }
  if (!Number.isInteger(a.port) || a.port < 0 || a.port > 65535) throw new Error("--port must be 0-65535");
  return a;
}

function packageRoot(): string {
  // Walk up from this file to the folder holding aidlc-ui's package.json
  // (dist/server/server/cli.js in a build, src/server/cli.ts under tsx).
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, "utf8")).name === "aidlc-ui") return dir;
      } catch {
        /* keep walking */
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error("cannot locate the aidlc-ui package root");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let args: Args | "help" | "version";
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`aidlc-ui: ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }
  const root = packageRoot();
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version as string;
  if (args === "help") return void console.log(HELP);
  if (args === "version") return void console.log(version);

  const prefs = new PrefStore(undefined, args.persist);
  await prefs.load();
  const registry = new WorkspaceRegistry();
  const webRoot = path.join(root, "dist", "web");
  const demoRoot = path.join(root, "demo", "workspace");
  const token = args.dev ? process.env.AIDLC_UI_DEV_TOKEN ?? newToken() : newToken();

  // Workspaces: explicit paths (or cwd), then previously registered ones.
  const explicit = args.paths.length ? args.paths : args.demo ? [] : [process.cwd()];
  let focus: string | null = null;
  for (const p of explicit) {
    try {
      const { root: wsRoot, note } = await resolveWorkspaceRoot(p);
      const detected = existsSync(path.join(wsRoot, "aidlc", "spaces")) || hasHarnessStamp(wsRoot) || existsSync(path.join(wsRoot, "aidlc-docs"));
      if (!detected && !args.paths.length) {
        console.log(`No AI-DLC workspace found at ${wsRoot}. The UI will help you connect one.`);
        continue;
      }
      if (note) console.log(note);
      const pref = await prefs.upsert(wsRoot);
      const ws = await registry.add({ id: pref.id, root: wsRoot, name: pref.name, demo: false, harness: pref.harness, cliProbe: args.cliProbe, watch: true });
      focus ??= pref.id;
      const s = ws.snapshot;
      const intents = s?.spaces.reduce((n, sp) => n + sp.intents.length, 0) ?? 0;
      const inst = s?.installations.find((i) => i.harnessDir === s.selectedInstallation);
      console.log(`Connected ${wsRoot}`);
      console.log(`  AI-DLC: ${inst?.frameworkVersion ?? "no installation found"}${inst ? ` (${inst.productName ?? inst.harnessDir})` : ""} · adapter: ${s?.compatibility.adapterId ?? "none"} · compatibility: ${s?.compatibility.level}`);
      console.log(`  ${s?.spaces.length ?? 0} space(s), ${intents} intent(s)`);
      for (const issue of s?.compatibility.issues.filter((i) => i.severity !== "info") ?? []) console.log(`  ! ${issue.message}`);
    } catch (err) {
      console.error(`aidlc-ui: cannot open ${p}: ${(err as Error).message}`);
    }
  }
  for (const w of prefs.get().workspaces) {
    if (registry.get(w.id)) continue;
    if (!existsSync(w.root)) continue;
    await registry.add({ id: w.id, root: w.root, name: w.name, demo: false, harness: w.harness, cliProbe: args.cliProbe, watch: true });
  }
  if (args.demo && existsSync(demoRoot)) {
    await registry.add({ id: DEMO_ID, root: demoRoot, name: "Demo workspace (synthetic)", demo: true, harness: null, cliProbe: false, watch: false });
    focus = DEMO_ID;
  }

  let started;
  try {
    started = await startServer(
      { host: args.host, port: args.port, webRoot: args.dev ? null : webRoot, demoRoot: existsSync(demoRoot) ? demoRoot : null, token, dev: args.dev, devPorts: [5173, 5174], cliProbe: args.cliProbe, prefs, version },
      registry,
    );
  } catch (err) {
    console.error(`aidlc-ui: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  if (!args.dev && !existsSync(path.join(webRoot, "index.html"))) {
    console.error("aidlc-ui: the web UI has not been built. Run `npm run build` first.");
  }
  const target = `${started.url}${focus ? `#/w/${encodeURIComponent(focus)}` : ""}`;
  console.log(`\naidlc-ui is running at ${target}`);
  console.log("Read-only: aidlc-ui never writes to your workspace. Press Ctrl+C to stop.");
  if (args.open && !args.dev) openBrowser(target);

  const shutdown = () => {
    registry.stopAll();
    started.server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function hasHarnessStamp(root: string): boolean {
  try {
    return readdirSync(root, { withFileTypes: true }).some(
      (e) => e.isDirectory() && e.name.startsWith(".") && existsSync(path.join(root, e.name, "tools", "data", "aidlc-stamp.json")),
    );
  } catch {
    return false;
  }
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  execFile(cmd, args as string[], { windowsHide: true }, () => {
    /* if it fails, the URL is printed above */
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) void main();
