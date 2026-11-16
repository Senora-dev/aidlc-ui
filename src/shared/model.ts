/**
 * aidlc-ui internal data model.
 *
 * This is the ONLY shape the browser UI understands. It is deliberately
 * version-neutral: no upstream file paths, field spellings, or schema
 * versions leak through except as opaque "raw" strings for display and as
 * `SourceRef`s that point back at the record a value came from.
 *
 * Adapters (src/adapters/*) translate upstream records into this model.
 */

export const MODEL_VERSION = 1;

/** Where a value came from, so the UI can link back to the real record. */
export interface SourceRef {
  /** Path relative to the workspace root, always forward slashes. */
  path: string;
  /** Optional 0-based block index inside the file (audit shards). */
  block?: number;
  /** Optional 1-based line number. */
  line?: number;
}

/**
 * How trustworthy / available a piece of data is.
 * - ok: parsed from a supported record
 * - missing: the record that should hold it does not exist
 * - unsupported: the record exists but its format/version is not supported
 * - stale: the last refresh failed; this is the previous good value
 * - empty: the record is valid and genuinely holds nothing
 * - error: the record exists but could not be read/parsed
 */
export type DataStatus = "ok" | "missing" | "unsupported" | "stale" | "empty" | "error";

export type CapabilityStatus = "supported" | "degraded" | "unavailable" | "unsupported";

export interface Capability {
  id: string;
  label: string;
  status: CapabilityStatus;
  detail: string;
  /** Evidence: which record(s) were probed. */
  evidence?: string[];
}

export type CompatLevel =
  | "verified" // version + schema in the tested matrix
  | "compatible" // schema probes pass; version not in tested matrix
  | "partial" // some capabilities unavailable or degraded
  | "incompatible" // records exist but cannot be read safely
  | "not-detected"; // no AI-DLC structures found

export interface Installation {
  /** Harness directory relative to the workspace root, e.g. ".claude". */
  harnessDir: string;
  distribution: string | null;
  productName: string | null;
  frameworkVersion: string | null;
  /** Stage definitions available from this installation. */
  stageDefinitions: number;
  stageDefinitionSource: string | null;
  source: SourceRef;
}

export interface CliProbe {
  attempted: boolean;
  found: boolean;
  binaryVersion: string | null;
  runtimeVersion: string | null;
  detail: string;
}

export interface Compatibility {
  level: CompatLevel;
  adapterId: string | null;
  adapterLabel: string | null;
  summary: string;
  issues: CompatIssue[];
  capabilities: Capability[];
  testedVersions: string[];
}

export interface CompatIssue {
  severity: "info" | "warning" | "error";
  message: string;
  action?: string;
  source?: SourceRef;
}

export type NormalizedStageState =
  | "completed"
  | "in-progress"
  | "awaiting-approval"
  | "revising"
  | "skipped" // skipped while the work ran ([S])
  | "not-in-plan" // the plan leaves it out (SKIP)
  | "pending" // in the plan, not started
  | "unknown";

export interface StageAttention {
  kind: "check-findings" | "unanswered-question" | "gate-open" | "revision" | "error-logged";
  message: string;
  source?: SourceRef;
}

export interface Stage {
  slug: string;
  name: string;
  /** Upstream stage number when known, e.g. "2.3". Display only. */
  number: string | null;
  phaseId: string;
  state: NormalizedStageState;
  /** The raw checkbox / plan text exactly as recorded. */
  rawState: string;
  rawPlan: string | null;
  inPlan: boolean;
  leadAgent: string | null;
  supportAgents: string[];
  description: string | null;
  /** True when the stage is not part of the installed definitions (custom, plugin removed, renamed). */
  definitionMissing: boolean;
  /** True when the definition came from a plugin or a non-core source, when known. */
  custom: boolean;
  startedAt: string | null;
  completedAt: string | null;
  lastEventAt: string | null;
  revisionCount: number;
  artifacts: string[]; // artifact ids
  attention: StageAttention[];
  source: SourceRef;
}

export interface Phase {
  id: string;
  name: string;
  /** Raw phase status text from the state file, if any. */
  rawStatus: string | null;
  status: "pending" | "active" | "verified" | "skipped" | "unknown";
  stages: Stage[];
}

export interface Progress {
  completed: number;
  planned: number;
  skippedDuringRun: number;
  inProgress: number;
  /** Plain-English explanation of how these numbers were calculated. */
  basis: string;
  /** Upstream's own summary numbers, when recorded, for cross-checking. */
  recordedSummary: { total: number | null; completed: number | null; inProgress: string | null } | null;
  mismatch: string | null;
}

export interface PendingDecision {
  kind: "approval-gate" | "question" | "plan-approval";
  stage: string | null;
  title: string;
  since: string | null;
  source: SourceRef;
}

export interface IntentSummary {
  key: string; // stable within a space: dir name
  uuid: string | null;
  dirName: string;
  label: string;
  space: string;
  scope: string | null;
  registryStatus: string | null; // raw
  lifecycle: "in-flight" | "complete" | "archived" | "parked" | "unknown";
  recordedStatus: string | null; // "Current Status > Status" raw
  currentStage: { slug: string; name: string } | null;
  progress: Progress | null;
  lastActivity: string | null;
  pending: PendingDecision[];
  dataStatus: DataStatus;
  issues: CompatIssue[];
  description: string | null;
  startedAt: string | null;
  active: boolean; // the space's active-intent cursor points here
}

export interface AuditEvent {
  id: string; // `${shardIndex}:${pos}`
  type: string;
  heading: string | null;
  timestamp: string | null;
  stage: string | null;
  fields: Array<[string, string]>;
  /** Text lines in the block that are not `**Field**: value` lines. */
  body: string | null;
  shard: string;
  pos: number;
  /** True when this event's order relative to a neighbour is unknown (cross-writer same-second tie). */
  unordered: boolean;
  /** True when the reader withdrew it (e.g. a HUMAN_TURN later taken back by a HOST_TURN). */
  withdrawn: boolean;
  known: boolean; // event type is known to the adapter
  source: SourceRef;
}

export interface DecisionEntry {
  id: string;
  kind: "question" | "answer" | "gate-approved" | "gate-rejected" | "gate-opened" | "plan-approval" | "review" | "other";
  stage: string | null;
  timestamp: string | null;
  title: string;
  options: string[];
  recommended: string | null;
  /** The engine/agent's recorded reading of the choice. */
  choice: string | null;
  /** The person's own words, as recorded. */
  personReply: string | null;
  /** Git name as recorded (not a verified identity). */
  gitName: string | null;
  questionId: string | null;
  answeredBy: string | null; // id of answer entry
  answerState: "answered" | "unanswered" | "closed-without-answer" | "n/a";
  unordered: boolean;
  eventType: string;
  source: SourceRef;
}

export interface Artifact {
  id: string; // workspace-relative path
  path: string;
  name: string;
  stage: string | null;
  phaseDir: string | null;
  kind: "markdown" | "json" | "text" | "other";
  size: number;
  modifiedAt: string | null;
  /** Recorded in the audit trail as created/updated by a tool. */
  recorded: boolean;
}

export interface IntentDetail extends IntentSummary {
  phases: Phase[];
  events: AuditEvent[];
  decisions: DecisionEntry[];
  artifacts: Artifact[];
  stateSections: Array<{ title: string; fields: Array<[string, string]>; source: SourceRef }>;
  shards: Array<{ path: string; events: number; readable: boolean }>;
  workflowStructureSource: string;
}

export interface SpaceSummary {
  name: string;
  active: boolean;
  intents: IntentSummary[];
  registry: { status: DataStatus; source: SourceRef | null; detail: string | null };
}

export interface WorkspaceSnapshot {
  modelVersion: number;
  id: string;
  name: string;
  root: string;
  demo: boolean;
  installations: Installation[];
  selectedInstallation: string | null;
  cli: CliProbe | null;
  compatibility: Compatibility;
  spaces: SpaceSummary[];
  dataStatus: DataStatus;
  refreshedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Monotonic counter, increments when content changes. */
  revision: number;
}

export interface WorkspaceListEntry {
  id: string;
  name: string;
  root: string;
  demo: boolean;
  level: CompatLevel;
  intents: number;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface ArtifactContent {
  path: string;
  size: number;
  truncated: boolean;
  text: string;
  kind: Artifact["kind"];
  modifiedAt: string | null;
}

export interface RawBlock {
  path: string;
  block: number | null;
  text: string;
}
