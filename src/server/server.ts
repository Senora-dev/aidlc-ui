/**
 * Minimal local HTTP service for aidlc-ui (node:http, no framework).
 *
 * Security model (see docs/SECURITY.md):
 *  - binds to loopback only;
 *  - Host header allowlist (DNS-rebinding protection);
 *  - every /api request needs the per-launch token (injected into the served
 *    page; cross-origin pages cannot read it) and, when an Origin header is
 *    present, a same-origin Origin; mutating requests REQUIRE a matching Origin;
 *  - no CORS headers are ever sent;
 *  - strict CSP: no inline or third-party scripts; artifact text is returned
 *    as JSON data, never served as HTML;
 *  - file reads are confined to connected workspace roots by RootFs and to
 *    non-hidden paths under aidlc/.
 */
import http from "node:http";
import crypto from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import type { ArtifactContent, RawBlock, WorkspaceSnapshot } from "../shared/model.js";
import { idFor, type PrefStore } from "./config.js";
import { FsGuardError, RootFs } from "./fsguard.js";
import { resolveWorkspaceRoot, WorkspaceRegistry } from "./workspaces.js";
import { splitBlocks } from "../adapters/aidlc-v2/audit.js";

export interface ServerOptions {
  host: string;
  port: number;
  webRoot: string | null; // built UI; null in dev (Vite serves it)
  demoRoot: string | null;
  token: string;
  dev: boolean;
  devPorts: number[];
  cliProbe: boolean;
  prefs: PrefStore;
  version: string;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
export const DEMO_ID = "demo";

export function assertLoopback(host: string): void {
  if (!LOOPBACK.has(host)) throw new Error(`Refusing to bind to ${host}: aidlc-ui only listens on loopback (127.0.0.1, ::1, localhost).`);
}

export async function startServer(opts: ServerOptions, registry: WorkspaceRegistry): Promise<{ server: http.Server; port: number; url: string }> {
  assertLoopback(opts.host);
  const sseClients = new Set<http.ServerResponse>();
  registry.onChange((id, snap: WorkspaceSnapshot) => {
    const payload = `event: snapshot\ndata: ${JSON.stringify({ id, revision: snap.revision, refreshedAt: snap.refreshedAt, dataStatus: snap.dataStatus, lastError: snap.lastError })}\n\n`;
    for (const c of sseClients) c.write(payload);
  });

  let boundPort = opts.port;
  const allowedHosts = () => {
    const ports = [boundPort, ...(opts.dev ? opts.devPorts : [])];
    return new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]));
  };
  const allowedOrigins = () => new Set([...allowedHosts()].map((h) => `http://${h}`));

  const server = http.createServer(async (req, res) => {
    try {
      baseHeaders(res);
      const host = String(req.headers.host ?? "").toLowerCase();
      if (!allowedHosts().has(host)) return send(res, 421, { error: "Unrecognised Host header" });
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
      return await staticFile(res, url.pathname);
    } catch (err) {
      const code = err instanceof FsGuardError ? (err.code === "not-found" ? 404 : 403) : 500;
      send(res, code, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const origin = req.headers.origin;
    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (origin !== undefined && !allowedOrigins().has(origin)) return send(res, 403, { error: "Cross-origin request refused" });
    if (mutating && origin === undefined) return send(res, 403, { error: "Origin header required" });
    const secFetch = req.headers["sec-fetch-site"];
    if (secFetch && secFetch !== "same-origin" && secFetch !== "none") return send(res, 403, { error: "Cross-site request refused" });
    const token = String(req.headers["x-aidlc-ui-token"] ?? url.searchParams.get("token") ?? "");
    if (!safeEqual(token, opts.token)) return send(res, 401, { error: "Missing or invalid session token. Reload the page." });

    const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // drop "api"
    const [a, b, c, d, e] = parts;

    if (a === "session" && req.method === "GET") {
      return send(res, 200, { version: opts.version, demoAvailable: Boolean(opts.demoRoot), workspaces: registry.list().map((w) => w.listEntry()) });
    }
    if (a === "events" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: {}\n\n`);
      sseClients.add(res);
      const hb = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15000);
      req.on("close", () => {
        clearInterval(hb);
        sseClients.delete(res);
      });
      return;
    }
    if (a === "demo" && req.method === "POST") {
      if (!opts.demoRoot) return send(res, 404, { error: "Demo data is not bundled with this build" });
      const ws = await registry.add({ id: DEMO_ID, root: opts.demoRoot, name: "Demo workspace (synthetic)", demo: true, harness: null, cliProbe: false, watch: false });
      return send(res, 200, ws.listEntry());
    }
    if (a !== "workspaces") return send(res, 404, { error: "Not found" });

    if (!b) {
      if (req.method === "GET") return send(res, 200, registry.list().map((w) => w.listEntry()));
      if (req.method === "POST") {
        const body = await readBody(req);
        const input = typeof body?.path === "string" ? body.path.trim() : "";
        if (!input || !path.isAbsolute(input)) return send(res, 400, { error: "Provide an absolute folder path." });
        const { root, note } = await resolveWorkspaceRoot(input);
        const pref = await opts.prefs.upsert(root);
        const ws = await registry.add({ id: pref.id, root, name: pref.name, demo: false, harness: pref.harness, cliProbe: opts.cliProbe, watch: true });
        return send(res, 200, { ...ws.listEntry(), note });
      }
      return send(res, 405, { error: "Method not allowed" });
    }
    const ws = registry.get(b);
    if (!ws) return send(res, 404, { error: "Unknown workspace" });

    if (!c) {
      if (req.method === "GET") return send(res, 200, ws.snapshot);
      if (req.method === "DELETE") {
        registry.remove(b);
        if (!ws.opts.demo) await opts.prefs.remove(b);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "Method not allowed" });
    }
    if (c === "refresh" && req.method === "POST") {
      await ws.refresh();
      return send(res, 200, ws.snapshot);
    }
    if (c === "installation" && req.method === "POST") {
      const body = await readBody(req);
      const harness = typeof body?.harness === "string" ? body.harness : null;
      if (harness !== null && !ws.snapshot?.installations.some((i) => i.harnessDir === harness)) return send(res, 400, { error: "Unknown installation" });
      ws.opts.harness = harness;
      if (!ws.opts.demo) await opts.prefs.setHarness(b, harness);
      await ws.refresh();
      return send(res, 200, ws.snapshot);
    }
    if (c === "intents" && d && e && req.method === "GET") {
      const detail = ws.details.get(`${d}/${e}`);
      if (!detail) return send(res, 404, { error: "Intent not found (it may have been removed)" });
      return send(res, 200, detail);
    }
    if (c === "file" && req.method === "GET") {
      const rel = readablePath(url.searchParams.get("path"));
      const { text, size, truncated, mtimeMs } = await ws.fs.readText(rel, 2 * 1024 * 1024);
      const ext = rel.split(".").pop()?.toLowerCase() ?? "";
      const looksBinary = text.slice(0, 4096).includes("\u0000");
      const out: ArtifactContent = {
        path: rel,
        size,
        truncated,
        text: looksBinary ? "" : text,
        kind: looksBinary ? "other" : ext === "md" || ext === "markdown" ? "markdown" : ext === "json" ? "json" : "text",
        modifiedAt: new Date(mtimeMs).toISOString(),
      };
      return send(res, 200, out);
    }
    if (c === "block" && req.method === "GET") {
      const rel = readablePath(url.searchParams.get("path"));
      const n = Number(url.searchParams.get("block"));
      const { text } = await ws.fs.readText(rel, 32 * 1024 * 1024);
      const blocks = splitBlocks(text);
      const out: RawBlock = { path: rel, block: Number.isInteger(n) ? n : null, text: Number.isInteger(n) && blocks[n] !== undefined ? blocks[n].trim() : text.slice(0, 200_000) };
      return send(res, 200, out);
    }
    return send(res, 404, { error: "Not found" });
  }

  async function staticFile(res: http.ServerResponse, pathname: string): Promise<void> {
    if (!opts.webRoot) return send(res, 404, { error: "UI is served by the dev server" });
    const rel = RootFs.normalizeRel(decodeURIComponent(pathname).replace(/^\/+/, ""));
    const webFs = new RootFs(opts.webRoot);
    let target = rel || "index.html";
    if (!(await webFs.exists(target)) || (await webFs.stat(target))?.isDir) target = "index.html";
    const abs = await webFs.resolve(target);
    let body: Buffer | string = await fsp.readFile(abs);
    const type = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
    if (target === "index.html") {
      body = body.toString("utf8").replace("<!--AIDLC_UI_TOKEN-->", `<meta name="aidlc-ui-token" content="${opts.token}">`);
      res.setHeader("cache-control", "no-store");
    } else if (target.startsWith("assets/")) res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.writeHead(200, { "content-type": type });
    res.end(body);
  }

  const port = await listen(server, opts.host, opts.port);
  boundPort = port;
  const shownHost = opts.host === "::1" ? "[::1]" : opts.host;
  return { server, port, url: `http://${shownHost}:${port}/` };
}

/** Only non-hidden paths inside aidlc/ are readable through the file API. */
export function readablePath(input: string | null): string {
  const rel = RootFs.normalizeRel(input ?? "");
  const segs = rel.split("/");
  if (segs[0] !== "aidlc" || segs.length < 2) throw new FsGuardError("Only files inside the workspace's aidlc/ folder can be opened", "outside-root");
  if (segs.some((s) => s.startsWith("."))) throw new FsGuardError("Hidden engine files are not exposed", "outside-root");
  return rel;
}

function listen(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = (p: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port !== 0 && tries < 20) {
          tries++;
          attempt(p + 1);
        } else reject(err);
      });
      server.listen(p, host, () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : p);
      });
    };
    attempt(port);
  });
}

function baseHeaders(res: http.ServerResponse): void {
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  const type = String(req.headers["content-type"] ?? "");
  if (!type.startsWith("application/json")) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function newToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export { idFor };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};
