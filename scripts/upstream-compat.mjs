#!/usr/bin/env node
/**
 * Upstream compatibility check (report-only).
 *
 * Downloads the runtime tarball of the newest stable and newest preview AI-DLC
 * releases, verifies its SHA-256 against the release's checksums.txt, extracts
 * it into a temp dir (data only; nothing from it is executed), and probes the
 * files aidlc-ui's adapter depends on. It never changes dependencies, code, or
 * releases anything. Exit code 1 when a probe fails, so CI can flag it.
 *
 *   node scripts/upstream-compat.mjs [--versions v2.11.4,v2.11.5-preview.20261114.1] [--json]
 *
 * Optional GITHUB_TOKEN raises the API rate limit.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "awslabs/aidlc-workflows";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const pinned = args.includes("--versions") ? args[args.indexOf("--versions") + 1].split(",") : null;
const headers = { "user-agent": "aidlc-ui-compat-check", accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

const adapterSrc = readFileSync(path.join(ROOT, "src/adapters/aidlc-v2/index.ts"), "utf8");
const TESTED = JSON.parse(/TESTED_VERSIONS = (\[[^\]]*\])/.exec(adapterSrc)[1].replace(/'/g, '"'));
const SUPPORTED_STATE = JSON.parse(/SUPPORTED_STATE_VERSIONS = (\[[^\]]*\])/.exec(readFileSync(path.join(ROOT, "src/adapters/aidlc-v2/intent.ts"), "utf8"))[1]);
// Events without which stage history/decisions cannot be read at all.
const REQUIRED = ["STAGE_STARTED", "STAGE_COMPLETED", "STAGE_AWAITING_APPROVAL", "GATE_APPROVED", "GATE_REJECTED", "DECISION_RECORDED", "QUESTION_ANSWERED", "ARTIFACT_CREATED"];
// Event types aidlc-ui interprets (not just displays).
const INTERPRETED = ["WORKFLOW_STARTED", "WORKFLOW_PARKED", "WORKFLOW_UNPARKED", "STAGE_STARTED", "STAGE_COMPLETED", "STAGE_AWAITING_APPROVAL", "STAGE_REVISING", "STAGE_SKIPPED", "DECISION_RECORDED", "QUESTION_ASKED", "QUESTION_ANSWERED", "QUESTION_REPLIED", "GATE_APPROVED", "GATE_REJECTED", "PLAN_APPROVAL_RECORDED", "REVIEW_COMPLETED", "ARTIFACT_CREATED", "ARTIFACT_UPDATED", "SENSOR_FAILED", "SENSOR_PASSED", "HUMAN_TURN", "HOST_TURN", "REQUEST_ROUTED"];

async function getJson(url) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
async function getBuf(url) {
  const r = await fetch(url, { headers: { "user-agent": headers["user-agent"] }, redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function pickReleases() {
  if (pinned) return Promise.all(pinned.map((t) => getJson(`https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(t)}`)));
  const rels = await getJson(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
  const stable = rels.find((r) => !r.prerelease && !r.draft);
  const preview = rels.find((r) => r.prerelease && !r.draft);
  return [stable, preview].filter(Boolean);
}

function probe(dir, version) {
  const out = [];
  const check = (id, ok, detail) => out.push({ id, ok: Boolean(ok), detail });
  const h = path.join(dir, "runtime", "claude", ".claude");
  const read = (p) => (existsSync(path.join(h, p)) ? readFileSync(path.join(h, p), "utf8") : null);

  const stamp = read("tools/data/aidlc-stamp.json");
  let stampJson = null;
  try { stampJson = JSON.parse(stamp); } catch { /* reported below */ }
  check("stamp", stampJson && typeof stampJson.frameworkVersion === "string", stampJson ? `frameworkVersion=${stampJson.frameworkVersion}` : "tools/data/aidlc-stamp.json missing or unreadable");

  let graph = null;
  try { graph = JSON.parse(read("tools/data/stage-graph.json")); } catch { /* reported below */ }
  const graphOk = Array.isArray(graph) && graph.every((s) => typeof s.slug === "string" && typeof s.phase === "string");
  check("stage-graph", graphOk, graphOk ? `${graph.length} stages, phases: ${[...new Set(graph.map((s) => s.phase))].join(", ")}` : "stage-graph.json missing or shape changed");

  const tmpl = read("knowledge/aidlc-shared/state-template.md") ?? "";
  const tmplOk = /State Version/.test(tmpl) && /## Stage Progress/.test(tmpl) && /\[\?\]/.test(tmpl) && /\[R\]/.test(tmpl) && /\[S\]/.test(tmpl);
  check("state-template", tmplOk, tmplOk ? "sections and six-state checkbox legend present" : "state-template.md changed (State Version / Stage Progress / checkbox legend)");

  const lib = read("tools/aidlc-lib.ts") ?? "";
  const sv = /CURRENT_STATE_VERSION = "(\d+)"/.exec(lib)?.[1] ?? null;
  check("state-version", sv && SUPPORTED_STATE.includes(sv), `CURRENT_STATE_VERSION=${sv ?? "not found"} (adapter supports ${SUPPORTED_STATE.join(",")})`);

  const core = read("tools/aidlc-record-core.ts") ?? lib;
  check("audit-grammar", /split\(\/\\n---\\n\/\)/.test(core), "audit shards split on \\n---\\n");

  const fmt = read("knowledge/aidlc-shared/audit-format.md") ?? "";
  const missing = INTERPRETED.filter((e) => !fmt.includes(e));
  const missingRequired = missing.filter((e) => REQUIRED.includes(e));
  check("audit-events", missingRequired.length === 0, missingRequired.length ? `core events not documented: ${missingRequired.join(", ")}` : `${INTERPRETED.length - missing.length}/${INTERPRETED.length} interpreted event types documented`);
  if (missing.length && !missingRequired.length) out.push({ id: "optional-events", ok: false, info: true, detail: `not in this release (their data is simply absent): ${missing.join(", ")}` });

  check("tested", TESTED.includes(version), TESTED.includes(version) ? "in aidlc-ui's tested set" : "not in the tested set (records will be labelled 'untested' if probes pass)");
  return out;
}

const report = [];
let failed = false;
for (const rel of await pickReleases()) {
  const version = rel.tag_name.replace(/^v/, "");
  const asset = rel.assets.find((a) => a.name === `aidlc-runtime-${version}.tar.gz`);
  const sums = rel.assets.find((a) => a.name === "checksums.txt");
  if (!asset || !sums) {
    report.push({ version, prerelease: rel.prerelease, error: "runtime tarball or checksums.txt not found on the release" });
    failed = true;
    continue;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "aidlc-compat-"));
  try {
    const tar = await getBuf(asset.browser_download_url);
    const expected = new RegExp(`^([a-f0-9]{64})\\s+${asset.name.replace(/\./g, "\\.")}$`, "m").exec((await getBuf(sums.browser_download_url)).toString())?.[1];
    const actual = createHash("sha256").update(tar).digest("hex");
    if (!expected || expected !== actual) throw new Error("checksum mismatch");
    const file = path.join(dir, asset.name);
    writeFileSync(file, tar);
    execFileSync("tar", ["-xzf", file, "-C", dir, "runtime/claude/.claude"], { stdio: "ignore" });
    const checks = probe(dir, version);
    const bad = checks.filter((c) => !c.ok && !c.info && c.id !== "tested");
    if (bad.length) failed = true;
    report.push({ version, prerelease: rel.prerelease, published: rel.published_at, checks });
  } catch (err) {
    report.push({ version, prerelease: rel.prerelease, error: err.message });
    failed = true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  for (const r of report) {
    console.log(`\nAI-DLC ${r.version}${r.prerelease ? " (preview)" : ""}${r.published ? ` · published ${r.published}` : ""}`);
    if (r.error) console.log(`  ERROR ${r.error}`);
    for (const c of r.checks ?? []) console.log(`  ${c.ok ? "PASS" : c.info || c.id === "tested" ? "INFO" : "FAIL"} ${c.id.padEnd(15)} ${c.detail}`);
  }
  console.log(failed ? "\nSome probes failed. The adapter may need maintenance. Nothing was changed." : "\nAll probes passed. Nothing was changed.");
}
process.exitCode = failed ? 1 : 0;
