/**
 * Local security: filesystem boundary, HTTP guards, artifact rendering, and
 * the guarantee that browsing never changes the upstream workspace.
 */
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown } from "../web/src/markdown.js";
import { PrefStore } from "../src/server/config.js";
import { FsGuardError, RootFs } from "../src/server/fsguard.js";
import { readablePath, startServer } from "../src/server/server.js";
import { WorkspaceRegistry } from "../src/server/workspaces.js";
import { tempCopy, tempDir, treeHash } from "./helpers.js";

describe("RootFs boundary", () => {
  it("rejects traversal, absolute paths and NUL bytes", async () => {
    const root = await tempDir();
    const f = new RootFs(root);
    for (const bad of ["../etc/passwd", "a/../../x", "/etc/passwd", "C:\\Windows", "a\0b", "..\\..\\x"]) {
      await expect(f.readText(bad)).rejects.toBeInstanceOf(FsGuardError);
    }
  });

  it.skipIf(process.platform === "win32")("refuses symlinks that escape the root, allows ones that stay inside", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    await fs.writeFile(path.join(root, "inside.txt"), "ok");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
    await fs.symlink(outside, path.join(root, "escape-dir"));
    await fs.symlink(path.join(root, "inside.txt"), path.join(root, "alias.txt"));
    const f = new RootFs(root);
    await expect(f.readText("escape.txt")).rejects.toMatchObject({ code: "outside-root" });
    await expect(f.readText("escape-dir/secret.txt")).rejects.toMatchObject({ code: "outside-root" });
    expect((await f.readText("alias.txt")).text).toBe("ok");
  });

  it("file API exposes only non-hidden paths under aidlc/", () => {
    expect(readablePath("aidlc/spaces/default/intents/x/requirements.md")).toBe("aidlc/spaces/default/intents/x/requirements.md");
    for (const bad of [".claude/settings.json", "src/index.ts", "aidlc/spaces/d/intents/x/.aidlc-engine/active-directive.json", "aidlc/.aidlc-sessions/current.transcript", "aidlc/../.env", "", null]) {
      expect(() => readablePath(bad as string)).toThrow();
    }
  });
});

describe("Markdown is rendered as untrusted content", () => {
  it("escapes raw HTML, drops script URLs, never loads images", () => {
    const html = renderMarkdown(
      [
        "<script>alert(1)</script>",
        '<img src=x onerror="alert(2)">',
        "[x](javascript:alert(3)) [y](data:text/html;base64,AAAA) [z](vbscript:msgbox)",
        "![pixel](https://tracker.example/p.gif)",
        "[ext](https://example.com) [rel](../other/file.md)",
      ].join("\n\n"),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/href="(javascript|data|vbscript):/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('class="md-image"');
    expect(html).toMatch(/<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer nofollow"/);
    expect(html).toContain('data-relative="../other/file.md"');
  });
});

describe("HTTP service guards and read-only browsing", () => {
  let base = "";
  let port = 0;
  let server: http.Server;
  let root = "";
  let before = "";
  const token = "t".repeat(48);
  const registry = new WorkspaceRegistry();

  beforeAll(async () => {
    root = await tempCopy("populated");
    // Make the tree contain a symlink escape attempt too.
    await fs.symlink("/etc/hosts", path.join(root, "aidlc/spaces/default/intents/261115-version-flag/inception/hosts.md")).catch(() => undefined);
    before = await treeHash(root);
    await registry.add({ id: "ws", root, name: "ws", demo: false, harness: null, cliProbe: false, watch: true });
    const webRoot = await tempDir();
    await fs.writeFile(path.join(webRoot, "index.html"), "<html><head><!--AIDLC_UI_TOKEN--></head></html>");
    const started = await startServer(
      { host: "127.0.0.1", port: 0, webRoot, demoRoot: null, token, dev: false, devPorts: [], cliProbe: false, prefs: new PrefStore(path.join(await tempDir(), "c.json"), false), version: "test" },
      registry,
    );
    server = started.server;
    port = started.port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => {
    registry.stopAll();
    server?.close();
  });

  const req = (p: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const r = http.request(`${base}${p}`, { method: init.method ?? "GET", headers: init.headers }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
      });
      r.on("error", reject);
      if (init.body) r.write(init.body);
      r.end();
    });
  const auth = { "x-aidlc-ui-token": "t".repeat(48) };

  it("refuses to bind outside loopback", async () => {
    await expect(
      startServer({ host: "0.0.0.0", port: 0, webRoot: null, demoRoot: null, token, dev: false, devPorts: [], cliProbe: false, prefs: new PrefStore(undefined, false), version: "x" }, new WorkspaceRegistry()),
    ).rejects.toThrow(/loopback/);
  });

  it("rejects DNS-rebinding Host headers", async () => {
    expect((await req("/api/session", { headers: { ...auth, host: `evil.example:${port}` } })).status).toBe(421);
    expect((await req("/", { headers: { host: "attacker.test" } })).status).toBe(421);
  });

  it("requires the session token and rejects cross-origin callers", async () => {
    expect((await req("/api/session")).status).toBe(401);
    expect((await req("/api/session", { headers: { ...auth, origin: "https://evil.example" } })).status).toBe(403);
    expect((await req("/api/session", { headers: { ...auth, "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await req("/api/workspaces", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: '{"path":"/"}' })).status).toBe(403);
    const ok = await req("/api/session", { headers: auth });
    expect(ok.status).toBe(200);
    expect(ok.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves a strict CSP and injects the token only into the page", async () => {
    const page = await req("/");
    expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.body).toContain('name="aidlc-ui-token"');
  });

  it("file API blocks traversal, hidden engine files and symlink escapes", async () => {
    const enc = encodeURIComponent;
    for (const p of ["../../../etc/passwd", ".claude/settings.json", "aidlc/spaces/default/intents/261115-csv-export-timeout/.aidlc-engine/x", "aidlc/spaces/default/intents/261115-version-flag/inception/hosts.md"]) {
      const r = await req(`/api/workspaces/ws/file?path=${enc(p)}`, { headers: auth });
      expect([403, 404]).toContain(r.status);
      expect(r.body).not.toContain("localhost");
    }
  });

  it("browsing every view leaves the workspace byte-for-byte unchanged", async () => {
    const snap = JSON.parse((await req("/api/workspaces/ws", { headers: auth })).body);
    for (const sp of snap.spaces) {
      for (const i of sp.intents) {
        const d = JSON.parse((await req(`/api/workspaces/ws/intents/${sp.name}/${i.dirName}`, { headers: auth })).body);
        for (const a of d.artifacts) expect((await req(`/api/workspaces/ws/file?path=${encodeURIComponent(a.path)}`, { headers: auth })).status).toBe(200);
        for (const e of d.events.slice(0, 20)) await req(`/api/workspaces/ws/block?path=${encodeURIComponent(e.source.path)}&block=${e.source.block}`, { headers: auth });
      }
    }
    await req("/api/workspaces/ws/refresh", { method: "POST", headers: { ...auth, origin: base } });
    expect(await treeHash(root)).toBe(before);
  });
});
