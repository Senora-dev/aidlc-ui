/**
 * Degradation behaviour, built by mutating copies of REAL upstream records:
 * missing optional/generated files, partial writes, concurrent updates,
 * unknown fields/events, unsupported formats and versions.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { intentsOf, scan, tempCopy, tempDir } from "./helpers.js";
import { Workspace } from "../src/server/workspaces.js";
import type { WorkspaceSnapshot } from "../src/shared/model.js";

const REC = "aidlc/spaces/default/intents/261115-csv-export-timeout";
const shardOf = async (root: string, rec = REC) => {
  const dir = path.join(root, rec, "audit");
  const [name] = await fs.readdir(dir);
  return path.join(dir, name);
};

describe("missing optional or generated files", () => {
  it("missing aidlc-state.md: falls back to what the audit trail proves and says so", async () => {
    const root = await tempCopy("populated");
    await fs.rm(path.join(root, REC, "aidlc-state.md"));
    const r = await scan(root);
    const d = r.details.get(`default/261115-csv-export-timeout`)!;
    expect(d.dataStatus).toBe("missing");
    expect(d.progress).toBeNull();
    expect(d.workflowStructureSource).toMatch(/audit trail only/);
    const stages = d.phases.flatMap((p) => p.stages);
    // Only stages with recorded events appear; pending ones are NOT invented.
    expect(stages.find((s) => s.slug === "requirements-analysis")?.state).toBe("completed");
    expect(stages.find((s) => s.slug === "build-and-test")).toBeUndefined();
  });

  it("missing intents.json: intents still listed from folders, registry marked missing", async () => {
    const root = await tempCopy("populated");
    await fs.rm(path.join(root, "aidlc/spaces/default/intents/intents.json"));
    const r = await scan(root);
    const sp = r.snapshot.spaces.find((s) => s.name === "default")!;
    expect(sp.registry.status).toBe("missing");
    expect(sp.intents.map((i) => i.dirName).sort()).toEqual(["261115-csv-export-timeout", "261115-inventory-api", "261115-version-flag"]);
    expect(sp.intents.every((i) => i.lifecycle !== "complete" || i.dirName === "261115-version-flag")).toBe(true);
  });

  it("registry row whose record folder is absent (e.g. not pulled): shown as missing, not as empty", async () => {
    const root = await tempCopy("populated");
    await fs.rm(path.join(root, "aidlc/spaces/default/intents/261115-inventory-api"), { recursive: true });
    const i = intentsOf(await scan(root)).find((x) => x.dirName === "261115-inventory-api")!;
    expect(i.dataStatus).toBe("missing");
    expect(i.progress).toBeNull();
  });

  it("missing stage-graph.json and stage files: still reads records, names fall back to slugs, level degrades", async () => {
    const root = await tempCopy("populated");
    await fs.rm(path.join(root, ".claude/tools/data/stage-graph.json"));
    const r = await scan(root);
    expect(r.snapshot.compatibility.level).toBe("partial");
    expect(r.snapshot.compatibility.capabilities.find((c) => c.id === "definitions")?.status).toBe("unavailable");
    const st = r.details.get("default/261115-csv-export-timeout")!.phases.flatMap((p) => p.stages).find((s) => s.slug === "requirements-analysis")!;
    expect(st.name).toBe("Requirements Analysis");
    expect(st.number).toBeNull();
  });

  it("no installation stamp at all: records-only, labelled compatible without a version", async () => {
    const root = await tempCopy("populated");
    await fs.rm(path.join(root, ".claude"), { recursive: true });
    const r = await scan(root);
    expect(r.snapshot.installations).toEqual([]);
    expect(["compatible", "partial"]).toContain(r.snapshot.compatibility.level);
    expect(intentsOf(r)).toHaveLength(4);
  });

  it("missing audit shards: decisions unavailable, stated as such", async () => {
    const root = await tempCopy("populated");
    await fs.rm(path.join(root, REC, "audit"), { recursive: true });
    const d = (await scan(root)).details.get("default/261115-csv-export-timeout")!;
    expect(d.decisions).toEqual([]);
    expect(d.issues.some((i) => /No audit shards/.test(i.message))).toBe(true);
    expect(d.progress?.completed).toBe(4); // state file still answers progress
  });

  it("a folder with no AI-DLC structures is reported as not detected", async () => {
    const root = await tempDir();
    await fs.writeFile(path.join(root, "README.md"), "# hello\n");
    const r = await scan(root);
    expect(r.snapshot.compatibility.level).toBe("not-detected");
    expect(r.snapshot.spaces).toEqual([]);
  });
});

describe("unknown fields and unsupported formats", () => {
  it("preserves unknown state fields and sections; displays unknown checkbox values as unknown", async () => {
    const root = await tempCopy("populated");
    const p = path.join(root, REC, "aidlc-state.md");
    let t = await fs.readFile(p, "utf8");
    t = t.replace("## Runtime State", "## Future Section\n- **Brand New Field**: hello\n\n## Runtime State");
    t = t.replace("- [ ] build-and-test — EXECUTE", "- [~] build-and-test — EXECUTE");
    await fs.writeFile(p, t);
    const d = (await scan(root)).details.get("default/261115-csv-export-timeout")!;
    expect(d.stateSections.find((s) => s.title === "Future Section")?.fields).toEqual([["Brand New Field", "hello"]]);
    const bt = d.phases.flatMap((p) => p.stages).find((s) => s.slug === "build-and-test")!;
    expect(bt.state).toBe("unknown");
    expect(bt.rawState).toContain("[~]");
  });

  it("unknown audit event types and fields are kept and shown generically", async () => {
    const root = await tempCopy("populated");
    const shard = await shardOf(root);
    await fs.appendFile(shard, "\n## Something New\n**Timestamp**: 2026-11-15T23:00:00Z\n**Event**: TELEPORT_COMPLETED\n**Stage**: code-generation\n**Warp Factor**: 9\n\n---\n");
    const d = (await scan(root)).details.get("default/261115-csv-export-timeout")!;
    const e = d.events.find((x) => x.type === "TELEPORT_COMPLETED")!;
    expect(e.known).toBe(false);
    expect(e.fields).toContainEqual(["Warp Factor", "9"]);
    expect(d.issues.some((i) => i.message.includes("TELEPORT_COMPLETED"))).toBe(true);
    expect(d.lastActivity).toBe("2026-11-15T23:00:00Z");
  });

  it("an unsupported State Version is never shown as valid progress", async () => {
    const root = await tempCopy("populated");
    const p = path.join(root, REC, "aidlc-state.md");
    await fs.writeFile(p, (await fs.readFile(p, "utf8")).replace("- **State Version**: 8", "- **State Version**: 9"));
    const r = await scan(root);
    const d = r.details.get("default/261115-csv-export-timeout")!;
    expect(d.dataStatus).toBe("unsupported");
    expect(d.progress).toBeNull();
    expect(d.issues[0].severity).toBe("error");
    expect(r.snapshot.compatibility.level).toBe("partial");
  });

  it("all intents unsupported => workspace incompatible", async () => {
    const root = await tempCopy("v2100");
    const p = path.join(root, "aidlc/spaces/default/intents/261115-health-endpoint/aidlc-state.md");
    await fs.writeFile(p, (await fs.readFile(p, "utf8")).replace(/- \*\*State Version\*\*: 8\n/, ""));
    expect((await scan(root)).snapshot.compatibility.level).toBe("incompatible");
  });

  it("AI-DLC 1.x layout (aidlc-docs/) is detected but not parsed", async () => {
    const root = await tempDir();
    await fs.mkdir(path.join(root, "aidlc-docs"));
    await fs.writeFile(path.join(root, "aidlc-docs/aidlc-state.md"), "# AI-DLC State Tracking\n");
    const r = await scan(root);
    expect(r.snapshot.compatibility.level).toBe("incompatible");
    expect(r.snapshot.compatibility.issues[0].message).toMatch(/1\.x layout/);
  });

  it("an untested future version passes as 'compatible' only when every probe passes; a new major is 'partial'", async () => {
    const root = await tempCopy("populated");
    const stamp = path.join(root, ".claude/tools/data/aidlc-stamp.json");
    const j = JSON.parse(await fs.readFile(stamp, "utf8"));
    await fs.writeFile(stamp, JSON.stringify({ ...j, frameworkVersion: "2.13.0" }));
    expect((await scan(root)).snapshot.compatibility.level).toBe("compatible");
    await fs.writeFile(stamp, JSON.stringify({ ...j, frameworkVersion: "3.0.0" }));
    const r = await scan(root);
    expect(r.snapshot.compatibility.level).toBe("partial");
  });

  it("lenient registry JSON (BOM, comments, trailing comma) reads as upstream documents", async () => {
    const root = await tempCopy("populated");
    const p = path.join(root, "aidlc/spaces/default/intents/intents.json");
    const t = await fs.readFile(p, "utf8");
    await fs.writeFile(p, "﻿// hand edited\n" + t.replace(/\n\]\s*$/, ",\n]\n"));
    expect(r(await scan(root))).toBe(3);
    function r(x: Awaited<ReturnType<typeof scan>>) {
      return x.snapshot.spaces.find((s) => s.name === "default")!.intents.filter((i) => i.registryStatus).length;
    }
  });

  it("two installations with different versions: ambiguity is reported and selection is honoured", async () => {
    const root = await tempCopy("populated");
    await fs.cp(path.join(root, ".claude"), path.join(root, ".kiro"), { recursive: true });
    const stamp = path.join(root, ".kiro/tools/data/aidlc-stamp.json");
    const j = JSON.parse(await fs.readFile(stamp, "utf8"));
    await fs.writeFile(stamp, JSON.stringify({ ...j, frameworkVersion: "2.10.0", distribution: "kiro", harnessDir: ".kiro" }));
    const a = await scan(root);
    expect(a.snapshot.installations).toHaveLength(2);
    expect(a.snapshot.compatibility.issues.some((i) => /2 AI-DLC installations/.test(i.message))).toBe(true);
    const b = await scan(root, ".kiro");
    expect(b.snapshot.selectedInstallation).toBe(".kiro");
  });
});

describe("audit trail ordering and copies", () => {
  it("marks same-second events from different writers as unordered", async () => {
    const root = await tempCopy("populated");
    const shard = await shardOf(root);
    const text = await fs.readFile(shard, "utf8");
    const ts = /\*\*Timestamp\*\*: (\S+)\n\*\*Event\*\*: GATE_APPROVED/.exec(text)![1];
    await fs.writeFile(path.join(path.dirname(shard), "teammate-host-abc123.md"), `# AI-DLC Audit Log\n\n## Note\n**Timestamp**: ${ts}\n**Event**: HUMAN_TURN\n**Session**: other\n\n---\n`);
    const d = (await scan(root)).details.get("default/261115-csv-export-timeout")!;
    expect(d.decisions.find((x) => x.kind === "gate-approved")?.unordered).toBe(true);
  });

  it("reads rows in a sync-tool conflict copy only once", async () => {
    const root = await tempCopy("populated");
    const shard = await shardOf(root);
    await fs.copyFile(shard, shard.replace(/\.md$/, " 2.md"));
    const before = (await scan(await tempCopy("populated"))).details.get("default/261115-csv-export-timeout")!;
    const after = (await scan(root)).details.get("default/261115-csv-export-timeout")!;
    expect(after.events.filter((e) => e.type !== "NOTE").length).toBe(before.events.filter((e) => e.type !== "NOTE").length);
    expect(after.decisions.some((d) => d.unordered)).toBe(false);
  });
});

describe("concurrent and partially written updates", () => {
  it("a half-written trailing audit block is ignored until complete", async () => {
    const root = await tempCopy("populated");
    const shard = await shardOf(root);
    await fs.appendFile(shard, "\n## Gate Approved\n**Timestamp**: 2026-11-16T00:00:00Z\n");
    const d1 = (await scan(root)).details.get("default/261115-csv-export-timeout")!;
    expect(d1.events.some((e) => e.timestamp === "2026-11-16T00:00:00Z" && e.type !== "NOTE")).toBe(false);
    await fs.appendFile(shard, "**Event**: GATE_APPROVED\n**Stage**: code-generation\n\n---\n");
    const d2 = (await scan(root)).details.get("default/261115-csv-export-timeout")!;
    expect(d2.events.some((e) => e.type === "GATE_APPROVED" && e.timestamp === "2026-11-16T00:00:00Z")).toBe(true);
  });

  it("a truncated registry is retried, then reported as an error without hiding the intents", async () => {
    const root = await tempCopy("populated");
    const p = path.join(root, "aidlc/spaces/default/intents/intents.json");
    const full = await fs.readFile(p, "utf8");
    await fs.writeFile(p, full.slice(0, 60));
    const snaps: WorkspaceSnapshot[] = [];
    const ws = new Workspace({ id: "t", root, name: "t", demo: false, harness: null, cliProbe: false, watch: false }, (_id, s) => snaps.push(s));
    // The writer finishes while the reader is retrying.
    setTimeout(() => void fs.writeFile(p, full), 100);
    await ws.refresh();
    const sp = ws.snapshot!.spaces.find((s) => s.name === "default")!;
    expect(sp.registry.status).toBe("ok");
    expect(ws.snapshot!.lastError).toBeNull();
  });

  it("keeps the last good snapshot and marks it stale when the workspace disappears", async () => {
    const root = await tempCopy("populated");
    const ws = new Workspace({ id: "t", root, name: "t", demo: false, harness: null, cliProbe: false, watch: false }, () => undefined);
    await ws.refresh();
    expect(ws.snapshot!.dataStatus).toBe("ok");
    await fs.rename(root, `${root}-moved`);
    await ws.refresh();
    expect(ws.snapshot!.dataStatus).toBe("stale");
    expect(ws.snapshot!.lastError).toMatch(/not reachable/);
    expect(intentsOf({ snapshot: ws.snapshot!, details: new Map() } as never)).toHaveLength(4);
  });

  it("survives a writer appending rows during repeated refreshes", async () => {
    const root = await tempCopy("populated");
    const shard = await shardOf(root);
    const ws = new Workspace({ id: "t", root, name: "t", demo: false, harness: null, cliProbe: false, watch: false }, () => undefined);
    let stop = false;
    const writer = (async () => {
      for (let i = 0; !stop && i < 200; i++) {
        await fs.appendFile(shard, `\n## Human Turn\n**Timestamp**: 2026-11-16T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z\n**Event**: HUMAN_TURN\n\n---\n`);
      }
    })();
    for (let i = 0; i < 10; i++) await ws.refresh();
    stop = true;
    await writer;
    await ws.refresh();
    expect(ws.snapshot!.dataStatus).toBe("ok");
    const d = ws.details.get("default/261115-csv-export-timeout")!;
    expect(d.events.filter((e) => e.type === "HUMAN_TURN").length).toBeGreaterThan(5);
  });
});
