/**
 * Installed stage definitions and installation identity.
 *
 * Sources, in order of preference (all inside the user's harness directory,
 * all projected by `aidlc config` and therefore durable install files, not
 * engine caches):
 *   1. <harness>/tools/data/stage-graph.json  (compiled graph; includes plugin stages)
 *   2. <harness>/aidlc-common/stages/<phase>/<slug>.md frontmatter
 * Identity:
 *   <harness>/tools/data/aidlc-stamp.json  {frameworkVersion, distribution, harnessDir}
 *   <harness>/tools/data/harness.json      {productName}
 */
import type { RootFs } from "../../server/fsguard.js";

export interface StageDef {
  slug: string;
  name: string | null;
  number: string | null;
  phase: string | null;
  leadAgent: string | null;
  supportAgents: string[];
  condition: string | null;
  plugin: string | null;
  produces: string[];
}

export interface InstallationInfo {
  harnessDir: string;
  frameworkVersion: string | null;
  distribution: string | null;
  productName: string | null;
  stampPath: string;
  stamp: Record<string, unknown> | null;
  stampError: string | null;
}

export async function findInstallations(fs: RootFs): Promise<InstallationInfo[]> {
  const out: InstallationInfo[] = [];
  for (const entry of await fs.list("")) {
    if (!entry.isDir || !entry.name.startsWith(".") || entry.name === ".git") continue;
    const stampPath = `${entry.name}/tools/data/aidlc-stamp.json`;
    if (!(await fs.exists(stampPath))) continue;
    let stamp: Record<string, unknown> | null = null;
    let stampError: string | null = null;
    try {
      const raw = await fs.readJson<unknown>(stampPath, 64 * 1024);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) stamp = raw as Record<string, unknown>;
      else stampError = "stamp is not a JSON object";
    } catch (err) {
      stampError = `could not read stamp: ${(err as Error).message}`;
    }
    let productName: string | null = null;
    try {
      const h = await fs.readJson<Record<string, unknown>>(`${entry.name}/tools/data/harness.json`, 256 * 1024);
      productName = typeof h?.productName === "string" ? h.productName : null;
    } catch {
      /* optional */
    }
    out.push({
      harnessDir: entry.name,
      frameworkVersion: typeof stamp?.frameworkVersion === "string" ? stamp.frameworkVersion : null,
      distribution: typeof stamp?.distribution === "string" ? stamp.distribution : null,
      productName,
      stampPath,
      stamp,
      stampError,
    });
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function loadStageDefs(fs: RootFs, harnessDir: string): Promise<{ defs: StageDef[]; source: string | null; error: string | null }> {
  const graphPath = `${harnessDir}/tools/data/stage-graph.json`;
  if (await fs.exists(graphPath)) {
    try {
      const raw = await fs.readJson<unknown>(graphPath, 16 * 1024 * 1024);
      if (Array.isArray(raw) && raw.every((x) => x && typeof x === "object" && typeof (x as { slug?: unknown }).slug === "string")) {
        const defs = (raw as Array<Record<string, unknown>>).map((s) => ({
          slug: s.slug as string,
          name: str(s.name),
          number: str(s.number),
          phase: str(s.phase),
          leadAgent: str(s.lead_agent),
          supportAgents: strs(s.support_agents),
          condition: str(s.condition),
          plugin: str(s.plugin),
          produces: strs(s.produces),
        }));
        return { defs, source: graphPath, error: null };
      }
      return { defs: await loadFromStageFiles(fs, harnessDir), source: `${harnessDir}/aidlc-common/stages`, error: "stage-graph.json has an unrecognised shape" };
    } catch (err) {
      const defs = await loadFromStageFiles(fs, harnessDir);
      return { defs, source: defs.length ? `${harnessDir}/aidlc-common/stages` : null, error: `stage-graph.json unreadable: ${(err as Error).message}` };
    }
  }
  const defs = await loadFromStageFiles(fs, harnessDir);
  return { defs, source: defs.length ? `${harnessDir}/aidlc-common/stages` : null, error: defs.length ? null : "no stage definitions found" };
}

async function loadFromStageFiles(fs: RootFs, harnessDir: string): Promise<StageDef[]> {
  const base = `${harnessDir}/aidlc-common/stages`;
  const defs: StageDef[] = [];
  for (const phase of await fs.list(base)) {
    if (!phase.isDir) continue;
    for (const file of await fs.list(`${base}/${phase.name}`)) {
      if (!file.isFile || !file.name.endsWith(".md")) continue;
      try {
        const { text } = await fs.readText(`${base}/${phase.name}/${file.name}`, 512 * 1024);
        const fm = parseFrontmatter(text);
        const slug = typeof fm.slug === "string" ? fm.slug : file.name.replace(/\.md$/, "");
        defs.push({
          slug,
          name: str(fm.name),
          number: str(fm.number),
          phase: str(fm.phase) ?? phase.name,
          leadAgent: str(fm.lead_agent),
          supportAgents: strs(fm.support_agents),
          condition: str(fm.condition),
          plugin: str(fm.plugin),
          produces: strs(fm.produces),
        });
      } catch {
        /* skip unreadable definition */
      }
    }
  }
  return defs;
}

/** Minimal YAML-frontmatter reader: scalars and simple "- item" lists. Never evaluates anything. */
export function parseFrontmatter(text: string): Record<string, string | string[]> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end < 0) return {};
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const cur = out[listKey];
      (Array.isArray(cur) ? cur : (out[listKey] = [])).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      listKey = kv[2] === "" ? kv[1] : null;
      out[kv[1]] = kv[2] === "" ? [] : unquote(kv[2]);
    }
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** Event names the installed version documents (backticked UPPER_SNAKE tokens in audit-format.md). */
export async function loadKnownEvents(fs: RootFs, harnessDir: string | null): Promise<{ events: Set<string>; source: string | null }> {
  const set = new Set<string>(BASELINE_EVENTS);
  if (!harnessDir) return { events: set, source: null };
  const p = `${harnessDir}/knowledge/aidlc-shared/audit-format.md`;
  try {
    const { text } = await fs.readText(p, 2 * 1024 * 1024);
    for (const m of text.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)) set.add(m[1]);
    return { events: set, source: p };
  } catch {
    return { events: set, source: null };
  }
}

/** Baseline: the event names aidlc-ui itself interprets. Anything else is displayed generically. */
const BASELINE_EVENTS = [
  "WORKFLOW_STARTED", "WORKFLOW_COMPLETED", "WORKFLOW_PARKED", "WORKFLOW_UNPARKED", "WORKFLOW_ARCHIVED", "WORKFLOW_UNARCHIVED",
  "PHASE_STARTED", "PHASE_COMPLETED", "PHASE_VERIFIED", "PHASE_SKIPPED",
  "STAGE_STARTED", "STAGE_AWAITING_APPROVAL", "STAGE_REVISING", "STAGE_COMPLETED", "STAGE_SKIPPED", "STAGE_JUMPED",
  "DECISION_RECORDED", "GATE_APPROVED", "GATE_REJECTED", "QUESTION_ANSWERED", "QUESTION_REPLIED", "QUESTION_ASKED",
  "PLAN_APPROVAL_RECORDED", "SUMMARY_CONFIRMATION_RECORDED", "REVIEW_REQUESTED", "REVIEW_COMPLETED",
  "ARTIFACT_CREATED", "ARTIFACT_UPDATED", "HUMAN_TURN", "HOST_TURN", "SENSOR_FAILED", "SENSOR_PASSED", "SENSOR_FIRED", "ERROR_LOGGED",
];
