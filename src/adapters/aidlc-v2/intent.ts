/**
 * Build one intent's internal model from its record directory.
 * Inputs are the parsed state file, the audit read, installed stage
 * definitions and the record's files. Nothing here writes.
 */
import type {
  Artifact,
  AuditEvent,
  CompatIssue,
  DataStatus,
  DecisionEntry,
  IntentDetail,
  NormalizedStageState,
  PendingDecision,
  Phase,
  Progress,
  Stage,
  StageAttention,
} from "../../shared/model.js";
import type { RootFs } from "../../server/fsguard.js";
import { readAudit, type AuditRead } from "./audit.js";
import { anyField, classifyStateVersion, field, parseStateFile, phaseIdFromHeading, titleCase, type ParsedState } from "./state-file.js";
import type { StageDef } from "./stage-defs.js";

export const SUPPORTED_STATE_VERSIONS = ["8"];

export interface RegistryRow {
  uuid: string | null;
  slug: string | null;
  dirName: string;
  scope: string | null;
  status: string | null;
  extra: Record<string, unknown>;
}

export interface IntentContext {
  fs: RootFs;
  space: string;
  spaceRel: string; // aidlc/spaces/<space>
  dirName: string;
  row: RegistryRow | null;
  defs: Map<string, StageDef>;
  defsSource: string | null;
  knownEvents: ReadonlySet<string>;
  activeIntent: string | null;
}

const BOX: Record<string, NormalizedStageState> = {
  x: "completed",
  X: "completed",
  "-": "in-progress",
  "?": "awaiting-approval",
  R: "revising",
  S: "skipped",
};

const ANSWER_EVENTS = new Set([
  "QUESTION_ANSWERED",
  "QUESTION_REPLIED",
  "PLAN_APPROVAL_RECORDED",
  "SUMMARY_CONFIRMATION_RECORDED",
  "CHECKPOINT_VERIFICATION_RECORDED",
  "VERIFICATION_COMMAND_RECORDED",
  "CONSTRUCTION_POLICY_RECORDED",
]);
const QUESTION_EVENTS = new Set(["DECISION_RECORDED", "QUESTION_ASKED"]);

export async function buildIntent(ctx: IntentContext): Promise<IntentDetail> {
  const { fs, spaceRel, dirName } = ctx;
  const recordRel = `${spaceRel}/intents/${dirName}`;
  const issues: CompatIssue[] = [];
  let dataStatus: DataStatus = "ok";

  // ---- state file
  const statePath = `${recordRel}/aidlc-state.md`;
  let state: ParsedState | null = null;
  let stateSupported = false;
  const stateStat = await fs.stat(statePath);
  if (!stateStat) {
    dataStatus = ctx.row ? "missing" : "missing";
    issues.push({
      severity: "warning",
      message: "This intent has no aidlc-state.md, so its stage progress is not recorded here.",
      action: "If you use git, check whether the state file was committed on another branch.",
      source: { path: statePath },
    });
  } else {
    try {
      state = parseStateFile((await fs.readText(statePath, 2 * 1024 * 1024)).text);
      const cls = classifyStateVersion(state.stateVersion, SUPPORTED_STATE_VERSIONS);
      if (cls === "ok") stateSupported = true;
      else {
        dataStatus = "unsupported";
        issues.push({
          severity: "error",
          message:
            cls === "unparseable"
              ? "The state file has no readable State Version, so its stage progress cannot be matched safely and is not shown as valid."
              : `The state file uses State Version ${state.stateVersion}, which this adapter does not support (supports ${SUPPORTED_STATE_VERSIONS.join(", ")}). Stage progress is not shown as valid.`,
          action: cls === "future" ? "Upgrade aidlc-ui, or check docs/COMPATIBILITY.md for a newer adapter." : undefined,
          source: { path: statePath },
        });
      }
    } catch (err) {
      dataStatus = "error";
      issues.push({ severity: "error", message: `Could not read aidlc-state.md: ${(err as Error).message}`, source: { path: statePath } });
    }
  }

  // ---- audit shards (tracked shards only; local engine records are transient and ignored)
  const auditDir = `${recordRel}/audit`;
  const shardTexts: Array<{ path: string; content: string }> = [];
  const unreadable: string[] = [];
  for (const e of (await fs.list(auditDir)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile || !e.name.endsWith(".md")) continue;
    const p = `${auditDir}/${e.name}`;
    try {
      shardTexts.push({ path: p, content: (await fs.readText(p, 32 * 1024 * 1024)).text });
    } catch {
      unreadable.push(p);
    }
  }
  const audit: AuditRead = readAudit(shardTexts, { knownEvents: ctx.knownEvents });
  for (const p of unreadable) audit.shards.push({ path: p, events: 0, readable: false });
  if (unreadable.length) issues.push({ severity: "warning", message: `${unreadable.length} audit shard(s) could not be read.` });
  const events = audit.events.filter((e) => !e.withdrawn);
  const allEvents = [...audit.events, ...audit.notes].sort(
    (a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "") || a.shard.localeCompare(b.shard) || a.pos - b.pos,
  );

  // ---- project description (committed sidecar)
  let description: string | null = null;
  try {
    const d = await fs.readJson<unknown>(`${recordRel}/project-description.json`, 256 * 1024);
    if (typeof d === "string") description = d;
  } catch {
    description = state ? anyField(state, "Project") : null;
  }

  // ---- artifacts
  const stageSlugs = new Set<string>(state?.stageRows.map((r) => r.slug) ?? []);
  for (const e of events) if (e.stage) stageSlugs.add(e.stage);
  const recordedFiles = new Set<string>();
  for (const e of events) {
    if (e.type !== "ARTIFACT_CREATED" && e.type !== "ARTIFACT_UPDATED") continue;
    const f = e.fields.find(([k]) => k === "File")?.[1];
    if (f) recordedFiles.add(f.replace(/^<project-dir>[\\/]/, "").replace(/\\/g, "/"));
  }
  const artifacts = await collectArtifacts(fs, recordRel, stageSlugs, recordedFiles);

  // ---- stages & phases
  const phases: Phase[] = [];
  let structureSource = "";
  if (state && stateSupported && state.stageRows.length) {
    structureSource = `Stage Progress in ${statePath}` + (ctx.defsSource ? `, enriched with installed definitions (${ctx.defsSource})` : "");
    const phaseStatus = new Map<string, string>();
    for (const s of state.sections.filter((x) => /phase progress/i.test(x.title))) {
      for (const f of s.fields) phaseStatus.set(phaseIdFromHeading(f.key), f.value);
    }
    for (const row of state.stageRows) {
      const phaseId = row.phaseHeading ? phaseIdFromHeading(row.phaseHeading) : ctx.defs.get(row.slug)?.phase ?? "unassigned";
      let phase = phases.find((p) => p.id === phaseId);
      if (!phase) {
        const raw = phaseStatus.get(phaseId) ?? null;
        phase = { id: phaseId, name: titleCase(phaseId), rawStatus: raw, status: normPhase(raw), stages: [] };
        phases.push(phase);
      }
      phase.stages.push(makeStage(row.slug, phaseId, row.box, row.plan, row.raw, { path: statePath, line: row.line }, ctx, events, artifacts));
    }
    // Phases present in Phase Progress but with no stage rows (keep them visible).
    for (const [id, raw] of phaseStatus) {
      if (!phases.some((p) => p.id === id)) phases.push({ id, name: titleCase(id), rawStatus: raw, status: normPhase(raw), stages: [] });
    }
  } else if (events.some((e) => e.type === "STAGE_STARTED")) {
    // Degraded: derive what the audit trail proves. Never invent pending stages.
    structureSource = `Derived from audit trail only (${state ? "state file not supported" : "state file missing"}); stages not yet started are unknown`;
    const seen: string[] = [];
    for (const e of events) if (e.stage && /^STAGE_/.test(e.type) && !seen.includes(e.stage)) seen.push(e.stage);
    for (const slug of seen) {
      const def = ctx.defs.get(slug);
      const phaseId = def?.phase ?? "unassigned";
      let phase = phases.find((p) => p.id === phaseId);
      if (!phase) phases.push((phase = { id: phaseId, name: titleCase(phaseId), rawStatus: null, status: "unknown", stages: [] }));
      const last = [...events].reverse().find((e) => e.stage === slug && /^STAGE_/.test(e.type));
      const box = last?.type === "STAGE_COMPLETED" ? "x" : last?.type === "STAGE_AWAITING_APPROVAL" ? "?" : last?.type === "STAGE_SKIPPED" ? "S" : "-";
      const st = makeStage(slug, phaseId, box, null, `from audit: ${last?.type ?? "?"}`, last?.source ?? { path: auditDir }, ctx, events, artifacts);
      st.state = last ? st.state : "unknown";
      phase.stages.push(st);
    }
  } else {
    structureSource = state ? "No stage rows recorded" : "No state file and no stage events";
  }

  // ---- decisions & pending
  const allStages = phases.flatMap((p) => p.stages);
  const decisions = buildDecisions(events, allStages);
  const lifecycle = computeLifecycle(ctx.row?.status ?? null, events, state);
  const pending: PendingDecision[] = [];
  if (lifecycle === "in-flight" || lifecycle === "parked") {
    for (const st of allStages) {
      if (st.state === "awaiting-approval") {
        const since = [...events].reverse().find((e) => e.type === "STAGE_AWAITING_APPROVAL" && e.stage === st.slug)?.timestamp ?? null;
        pending.push({ kind: "approval-gate", stage: st.slug, title: `${st.name} is waiting for approval`, since, source: st.source });
      }
    }
    for (const d of decisions) {
      if (d.kind === "question" && d.answerState === "unanswered") {
        pending.push({ kind: d.title === "Approve the code plan" ? "plan-approval" : "question", stage: d.stage, title: d.title, since: d.timestamp, source: d.source });
      }
    }
  }
  for (const st of allStages) {
    for (const d of decisions) if (d.stage === st.slug && d.kind === "question" && d.answerState === "unanswered" && pending.some((p) => p.source === d.source)) {
      st.attention.push({ kind: "unanswered-question", message: `Unanswered in the record: ${truncate(d.title, 90)}`, source: d.source });
    }
  }

  // ---- progress
  const progress = state && stateSupported ? computeProgress(allStages, state) : null;

  // ---- current stage
  let currentStage: IntentDetail["currentStage"] = null;
  if (lifecycle !== "complete") {
    const active = allStages.find((s) => s.state === "awaiting-approval" || s.state === "revising" || s.state === "in-progress");
    const slug = active?.slug ?? (state ? field(state, "Current Status", "Current Stage") : null);
    if (slug && slug !== "none") currentStage = { slug, name: allStages.find((s) => s.slug === slug)?.name ?? ctx.defs.get(slug)?.name ?? titleCase(slug) };
  }

  const lastActivity =
    events.reduce<string | null>((acc, e) => (e.timestamp && (!acc || e.timestamp > acc) ? e.timestamp : acc), null) ??
    (state ? field(state, "Current Status", "Last Updated") : null);

  if (!shardTexts.length && !unreadable.length) {
    issues.push({ severity: "info", message: "No audit shards were found for this intent; decisions and history are unavailable.", source: { path: auditDir } });
  }
  if (audit.copiedRows) issues.push({ severity: "info", message: `${audit.copiedRows} audit row(s) repeated in a copied shard were read once.` });
  const unknownTypes = [...new Set(events.filter((e) => !e.known).map((e) => e.type))];
  if (unknownTypes.length) {
    issues.push({ severity: "info", message: `Event types not documented by the selected installation are shown generically: ${unknownTypes.join(", ")}` });
  }
  if (ctx.row && ctx.row.dirName !== dirName) issues.push({ severity: "warning", message: "Registry row and folder name disagree." });

  return {
    key: dirName,
    uuid: ctx.row?.uuid ?? null,
    dirName,
    label: ctx.row?.slug ? titleCase(ctx.row.slug) : titleCase(dirName.replace(/^\d{6}-/, "")),
    space: ctx.space,
    scope: ctx.row?.scope ?? (state ? field(state, "Project Information", "Scope") : null),
    registryStatus: ctx.row?.status ?? null,
    lifecycle,
    recordedStatus: state ? field(state, "Current Status", "Status") : null,
    currentStage,
    progress,
    lastActivity,
    pending,
    dataStatus,
    issues,
    description,
    startedAt: (state ? field(state, "Project Information", "Start Date") : null) ?? events.find((e) => e.type === "WORKFLOW_STARTED")?.timestamp ?? null,
    active: ctx.activeIntent === dirName,
    phases,
    events: allEvents,
    decisions,
    artifacts,
    stateSections: (state?.sections ?? []).map((s) => ({ title: s.title, fields: s.fields.map((f) => [f.key, f.value] as [string, string]), source: { path: statePath, line: s.line } })),
    shards: audit.shards,
    workflowStructureSource: structureSource,
  };
}

function makeStage(
  slug: string,
  phaseId: string,
  box: string,
  plan: string | null,
  raw: string,
  source: Stage["source"],
  ctx: IntentContext,
  events: AuditEvent[],
  artifacts: Artifact[],
): Stage {
  const def = ctx.defs.get(slug);
  const planWord = plan?.split(/\s+/)[0]?.toUpperCase() ?? null;
  const inPlan = planWord === null ? box !== " " : planWord !== "SKIP";
  let state: NormalizedStageState;
  if (box === " ") state = planWord === "SKIP" ? "not-in-plan" : planWord === "EXECUTE" || planWord === null ? "pending" : "unknown";
  else state = BOX[box] ?? "unknown";
  const mine = events.filter((e) => e.stage === slug);
  const attention: StageAttention[] = [];
  // Check findings: a SENSOR_FAILED with no later SENSOR_PASSED for the same sensor+output.
  const failures = new Map<string, AuditEvent>();
  for (const e of mine) {
    const key = `${e.fields.find(([k]) => k === "Sensor ID")?.[1]}|${e.fields.find(([k]) => k === "Output path")?.[1]}`;
    if (e.type === "SENSOR_FAILED") failures.set(key, e);
    if (e.type === "SENSOR_PASSED") failures.delete(key);
  }
  if (failures.size && state !== "completed" && state !== "skipped" && state !== "not-in-plan") {
    const first = [...failures.values()][0];
    attention.push({ kind: "check-findings", message: `${failures.size} automated check(s) reported findings that the record does not show as resolved`, source: first.source });
  }
  const revisions = mine.filter((e) => e.type === "STAGE_REVISING").length;
  if (state === "revising") attention.push({ kind: "revision", message: "Changes were requested at the approval gate; the stage is being revised.", source });
  return {
    slug,
    name: def?.name ?? titleCase(slug),
    number: def?.number ?? null,
    phaseId,
    state,
    rawState: raw,
    rawPlan: plan,
    inPlan,
    leadAgent: def?.leadAgent ?? null,
    supportAgents: def?.supportAgents ?? [],
    description: def?.condition ?? null,
    definitionMissing: !def && ctx.defs.size > 0,
    custom: Boolean(def?.plugin),
    startedAt: mine.find((e) => e.type === "STAGE_STARTED")?.timestamp ?? null,
    completedAt: [...mine].reverse().find((e) => e.type === "STAGE_COMPLETED")?.timestamp ?? null,
    lastEventAt: mine.length ? mine[mine.length - 1].timestamp : null,
    revisionCount: revisions,
    artifacts: artifacts.filter((a) => a.stage === slug).map((a) => a.id),
    attention,
    source,
  };
}

function normPhase(raw: string | null): Phase["status"] {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "pending") return "pending";
  if (v === "active") return "active";
  if (v === "verified" || v === "complete" || v === "completed") return "verified";
  if (v === "skipped") return "skipped";
  return "unknown";
}

function computeLifecycle(registryStatus: string | null, events: AuditEvent[], state: ParsedState | null): IntentDetail["lifecycle"] {
  const lastPark = [...events].reverse().find((e) => e.type === "WORKFLOW_PARKED" || e.type === "WORKFLOW_UNPARKED");
  const s = (registryStatus ?? "").toLowerCase();
  if (s === "archived") return "archived";
  if (s === "complete" || s === "completed") return "complete";
  if (lastPark?.type === "WORKFLOW_PARKED") return "parked";
  if (s === "in-flight") return "in-flight";
  if (!registryStatus) {
    const st = state ? field(state, "Current Status", "Status") : null;
    if (st && /^completed?$/i.test(st)) return "complete";
    if (st) return "in-flight";
  }
  return "unknown";
}

function computeProgress(stages: Stage[], state: ParsedState): Progress {
  const planned = stages.filter((s) => s.inPlan);
  const completed = planned.filter((s) => s.state === "completed").length;
  const skipped = stages.filter((s) => s.state === "skipped").length;
  const inProgress = planned.filter((s) => s.state === "in-progress" || s.state === "awaiting-approval" || s.state === "revising").length;
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
  const total = num(field(state, "Execution Plan Summary", "Total Stages"));
  const done = num(field(state, "Execution Plan Summary", "Completed"));
  const ip = field(state, "Execution Plan Summary", "In Progress");
  let mismatch: string | null = null;
  if (total !== null && total !== planned.length) mismatch = `The state file's summary says ${total} stages in total, but ${planned.length} stage rows are marked to execute.`;
  else if (done !== null && done !== completed) mismatch = `The state file's summary says ${done} completed, but ${completed} stage rows are checked [x].`;
  return {
    completed,
    planned: planned.length,
    skippedDuringRun: skipped,
    inProgress,
    basis:
      `Counted from the Stage Progress checklist in aidlc-state.md: ${completed} of ${planned.length} stages marked to execute are checked [x].` +
      (skipped ? ` ${skipped} stage(s) were skipped while the work ran ([S]) and are not counted as done.` : "") +
      " Stages the plan leaves out (SKIP) are excluded. The count includes the initialization stages AI-DLC runs automatically when it creates the work.",
    recordedSummary: total !== null || done !== null || ip ? { total, completed: done, inProgress: ip } : null,
    mismatch,
  };
}

function splitOptions(raw: string | null): string[] {
  if (!raw) return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr.map((x) => (typeof x === "string" ? x : typeof x?.label === "string" ? x.label : JSON.stringify(x)));
    } catch {
      /* fall through */
    }
  }
  if (t.startsWith("|")) return t.split("|").map((s) => s.trim()).filter(Boolean);
  return t.split(",").map((s) => s.trim()).filter(Boolean);
}

const f = (e: AuditEvent, k: string): string | null => e.fields.find(([key]) => key === k)?.[1] ?? null;

function buildDecisions(events: AuditEvent[], stages: Stage[]): DecisionEntry[] {
  const out: DecisionEntry[] = [];
  const open: DecisionEntry[] = [];
  const stageState = new Map(stages.map((s) => [s.slug, s.state]));
  for (const e of events) {
    const base = { id: e.id, stage: e.stage, timestamp: e.timestamp, unordered: e.unordered, eventType: e.type, source: e.source, gitName: f(e, "Git Name"), questionId: f(e, "Question Id") };
    // Exact closure by id: a later non-question row naming the question's id (e.g. REQUEST_ROUTED's Request).
    if (!QUESTION_EVENTS.has(e.type)) {
      const ref = f(e, "Request") ?? f(e, "Question Id");
      const hit = ref ? open.findIndex((q) => q.questionId === ref) : -1;
      if (hit >= 0) {
        open[hit].answerState = "answered";
        open[hit].answeredBy = e.id;
        open.splice(hit, 1);
        if (!ANSWER_EVENTS.has(e.type)) {
          out.push({ ...base, kind: "answer", title: e.heading ?? titleCase(e.type.toLowerCase()), options: [], recommended: null, choice: f(e, "Details") ?? f(e, "Choice"), personReply: f(e, "Person Reply"), answeredBy: null, answerState: "n/a" });
          continue;
        }
      }
    }
    if (QUESTION_EVENTS.has(e.type)) {
      const entry: DecisionEntry = {
        ...base,
        kind: "question",
        title: f(e, "Decision") ?? f(e, "Question") ?? askTitle(f(e, "Question Type")),
        options: splitOptions(f(e, "Options")),
        recommended: f(e, "Recommended"),
        choice: null,
        personReply: null,
        answeredBy: null,
        answerState: "unanswered",
      };
      out.push(entry);
      open.push(entry);
    } else if (ANSWER_EVENTS.has(e.type)) {
      const entry: DecisionEntry = {
        ...base,
        kind: e.type === "PLAN_APPROVAL_RECORDED" ? "plan-approval" : "answer",
        title: e.heading ?? titleCase(e.type.toLowerCase()),
        options: splitOptions(f(e, "Options")),
        recommended: f(e, "Recommended"),
        choice: f(e, "Details") ?? f(e, "Choice") ?? f(e, "Decision") ?? f(e, "Reply"),
        personReply: f(e, "Person Reply") ?? (e.type === "QUESTION_REPLIED" ? f(e, "Reply") : null),
        answeredBy: null,
        answerState: "n/a",
      };
      // One reply closes every still-open question logged earlier in the same stage.
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i].stage === e.stage) {
          open[i].answerState = "answered";
          open[i].answeredBy = entry.id;
          open.splice(i, 1);
        }
      }
      out.push(entry);
    } else if (e.type === "GATE_APPROVED" || e.type === "GATE_REJECTED") {
      out.push({
        ...base,
        kind: e.type === "GATE_APPROVED" ? "gate-approved" : "gate-rejected",
        title: e.type === "GATE_APPROVED" ? "Approval gate: approved" : "Approval gate: changes requested",
        options: [],
        recommended: null,
        choice: f(e, "User Input") ?? f(e, "Decision"),
        personReply: f(e, "Person Reply") ?? f(e, "Feedback"),
        answeredBy: null,
        answerState: "n/a",
      });
    } else if (e.type === "STAGE_AWAITING_APPROVAL") {
      out.push({ ...base, kind: "gate-opened", title: "Approval gate opened", options: [], recommended: null, choice: null, personReply: null, answeredBy: null, answerState: "n/a" });
    } else if (e.type === "REVIEW_COMPLETED") {
      out.push({ ...base, kind: "review", title: `Review by ${f(e, "Reviewer") ?? "reviewer"}`, options: [], recommended: null, choice: f(e, "Verdict"), personReply: null, answeredBy: null, answerState: "n/a" });
    } else if (/_RECORDED$|_OVERRIDDEN$|_SKIPPED$/.test(e.type) && /PLAN_APPROVAL|SUMMARY|POLICY|VERIFICATION/.test(e.type)) {
      out.push({ ...base, kind: "other", title: e.heading ?? e.type, options: [], recommended: null, choice: f(e, "Details") ?? f(e, "Decision"), personReply: f(e, "Person Reply"), answeredBy: null, answerState: "n/a" });
    } else if (e.type === "STAGE_COMPLETED" || e.type === "STAGE_SKIPPED") {
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i].stage === e.stage) {
          open[i].answerState = "closed-without-answer";
          open.splice(i, 1);
        }
      }
    }
  }
  // A question whose stage is no longer active is not "pending" even without an answer row.
  for (const q of open) {
    const st = q.stage ? stageState.get(q.stage) : undefined;
    if (st && st !== "in-progress" && st !== "awaiting-approval" && st !== "revising") q.answerState = "closed-without-answer";
  }
  return out;
}

async function collectArtifacts(fs: RootFs, recordRel: string, stageSlugs: Set<string>, recorded: Set<string>): Promise<Artifact[]> {
  const out: Artifact[] = [];
  const walk = async (rel: string, depth: number, phaseDir: string | null, stage: string | null) => {
    if (depth > 5 || out.length > 2000) return;
    for (const e of await fs.list(rel)) {
      if (e.name.startsWith(".") || e.isSymlink) continue;
      const child = `${rel}/${e.name}`;
      if (depth === 0 && (e.name === "audit" || !e.isDir)) continue; // record files are shown elsewhere
      if (e.isDir) {
        const nextPhase = depth === 0 ? e.name : phaseDir;
        const nextStage = depth === 1 && stageSlugs.has(e.name) ? e.name : depth === 1 ? e.name : stage;
        await walk(child, depth + 1, nextPhase, nextStage);
      } else if (e.isFile) {
        const st = await fs.stat(child);
        const ext = e.name.split(".").pop()?.toLowerCase() ?? "";
        out.push({
          id: child,
          path: child,
          name: e.name,
          stage: stage && stageSlugs.has(stage) ? stage : stage,
          phaseDir,
          kind: ext === "md" || ext === "markdown" ? "markdown" : ext === "json" ? "json" : ["txt", "yaml", "yml", "tsv", "csv", "log"].includes(ext) ? "text" : "other",
          size: st?.size ?? 0,
          modifiedAt: st ? new Date(st.mtimeMs).toISOString() : null,
          recorded: recorded.has(child),
        });
      }
    }
  };
  await walk(recordRel, 0, null, null);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Titles for engine asks that carry only a type (QUESTION_ASKED). Unknown types are humanised, never hidden. */
function askTitle(type: string | null): string {
  const known: Record<string, string> = {
    "plan-approval": "Approve the code plan",
    "new-work-routing": "Is this new request part of the active work?",
    "guard-recovery": "How should the blocked step continue?",
  };
  if (!type) return "Question";
  return known[type] ?? `${titleCase(type)} question`;
}
