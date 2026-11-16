/**
 * Adapter: "aidlc-records-v2"
 *
 * Reads AI-DLC 2.x workspace records, read-only:
 *   aidlc/spaces/<space>/intents/intents.json          registry (lenient JSON)
 *   aidlc/spaces/<space>/intents/<record>/aidlc-state.md  (State Version 8)
 *   aidlc/spaces/<space>/intents/<record>/audit/*.md       per-writer shards
 *   aidlc/spaces/<space>/intents/<record>/<phase>/<stage>/* artifacts
 *   <harness>/tools/data/aidlc-stamp.json / stage-graph.json  installation
 *
 * Verified against records produced by the real upstream engine at
 * 2.10.0, 2.11.4 and 2.11.5-preview.20261114.1 (see docs/COMPATIBILITY.md).
 * These are file formats, not a supported upstream API: upstream may change
 * them. Every probe below degrades instead of guessing.
 */
import type {
  Capability,
  CompatIssue,
  Compatibility,
  Installation,
  IntentDetail,
  SpaceSummary,
} from "../../shared/model.js";
import type { RootFs } from "../../server/fsguard.js";
import { buildIntent, SUPPORTED_STATE_VERSIONS, type RegistryRow } from "./intent.js";
import { findInstallations, loadKnownEvents, loadStageDefs, type InstallationInfo, type StageDef } from "./stage-defs.js";

export const ADAPTER_ID = "aidlc-records-v2";
export const ADAPTER_LABEL = "AI-DLC 2.x workspace records (read-only file adapter)";
/** Exact upstream versions whose generated records were tested. */
export const TESTED_VERSIONS = ["2.10.0", "2.11.4", "2.11.5-preview.20261114.1"];
/** Release line whose layout the adapter is designed for (State Version 8 shipped from 2.7.0). */
const DESIGNED_FOR = { major: 2, minMinor: 7 };

export interface V2Scan {
  installations: Installation[];
  selected: string | null;
  compatibility: Compatibility;
  spaces: SpaceSummary[];
  details: Map<string, IntentDetail>; // key `${space}/${dirName}`
}

export async function probe(fs: RootFs): Promise<{ records: boolean; installations: InstallationInfo[] }> {
  const records = await fs.exists("aidlc/spaces");
  const installations = await findInstallations(fs);
  return { records, installations };
}

export async function scan(fs: RootFs, preferredHarness: string | null): Promise<V2Scan> {
  const issues: CompatIssue[] = [];
  const caps: Capability[] = [];
  const infos = await findInstallations(fs);

  // ---- installation selection
  let selectedInfo: InstallationInfo | null = null;
  if (infos.length === 1) selectedInfo = infos[0];
  else if (infos.length > 1) {
    selectedInfo = infos.find((i) => i.harnessDir === preferredHarness) ?? null;
    const versions = new Set(infos.map((i) => i.frameworkVersion));
    if (!selectedInfo) {
      selectedInfo = infos[0];
      issues.push({
        severity: versions.size > 1 ? "warning" : "info",
        message: `Found ${infos.length} AI-DLC installations (${infos.map((i) => `${i.harnessDir} ${i.frameworkVersion ?? "?"}`).join(", ")}). Using ${selectedInfo.harnessDir} for stage definitions.`,
        action: "Choose the installation you use in Connection details.",
      });
    }
  }
  for (const i of infos) if (i.stampError) issues.push({ severity: "warning", message: `${i.harnessDir}: ${i.stampError}`, source: { path: i.stampPath } });

  const installations: Installation[] = [];
  let defs: StageDef[] = [];
  let defsSource: string | null = null;
  for (const info of infos) {
    const loaded = await loadStageDefs(fs, info.harnessDir);
    if (info === selectedInfo) {
      defs = loaded.defs;
      defsSource = loaded.source;
      if (loaded.error) issues.push({ severity: "warning", message: `Stage definitions: ${loaded.error}` });
    }
    installations.push({
      harnessDir: info.harnessDir,
      distribution: info.distribution,
      productName: info.productName,
      frameworkVersion: info.frameworkVersion,
      stageDefinitions: loaded.defs.length,
      stageDefinitionSource: loaded.source,
      source: { path: info.stampPath },
    });
  }
  const defMap = new Map(defs.map((d) => [d.slug, d]));
  const known = await loadKnownEvents(fs, selectedInfo?.harnessDir ?? null);

  caps.push(
    selectedInfo
      ? { id: "installation", label: "Installed version", status: selectedInfo.frameworkVersion ? "supported" : "degraded", detail: selectedInfo.frameworkVersion ? `${selectedInfo.productName ?? selectedInfo.distribution ?? selectedInfo.harnessDir} · AI-DLC ${selectedInfo.frameworkVersion}` : "Installation found but its version stamp is unreadable", evidence: [selectedInfo.stampPath] }
      : { id: "installation", label: "Installed version", status: "unavailable", detail: "No AI-DLC harness installation (…/tools/data/aidlc-stamp.json) was found in this folder. Records can still be read.", evidence: [] },
  );
  caps.push(
    defs.length
      ? { id: "definitions", label: "Workflow definitions", status: defsSource?.endsWith("stage-graph.json") ? "supported" : "degraded", detail: `${defs.length} stage definitions${defs.some((d) => d.plugin) ? ` (incl. ${defs.filter((d) => d.plugin).length} from plugins)` : ""}`, evidence: defsSource ? [defsSource] : [] }
      : { id: "definitions", label: "Workflow definitions", status: "unavailable", detail: "No installed stage definitions; stage names fall back to their slugs.", evidence: [] },
  );
  caps.push({ id: "event-vocabulary", label: "Audit event vocabulary", status: known.source ? "supported" : "degraded", detail: known.source ? `${known.events.size} event names documented by the installation` : "Installed audit-format reference not found; using aidlc-ui's baseline list", evidence: known.source ? [known.source] : [] });

  // ---- spaces & intents
  const spaces: SpaceSummary[] = [];
  const details = new Map<string, IntentDetail>();
  let activeSpace: string | null = null;
  try {
    activeSpace = (await fs.readText("aidlc/active-space", 4096)).text.trim() || null;
  } catch {
    /* cursor is per-user and optional */
  }
  const spaceEntries = (await fs.list("aidlc/spaces")).filter((e) => e.isDir && !e.name.startsWith("."));
  let intentCount = 0;
  let registryProblems = 0;
  let stateUnsupported = 0;
  let auditCount = 0;
  for (const sp of spaceEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    const spaceRel = `aidlc/spaces/${sp.name}`;
    const regPath = `${spaceRel}/intents/intents.json`;
    let rows: RegistryRow[] = [];
    let registry: SpaceSummary["registry"] = { status: "ok", source: { path: regPath }, detail: null };
    if (await fs.exists(regPath)) {
      try {
        const raw = await fs.readJson<unknown>(regPath, 8 * 1024 * 1024);
        if (!Array.isArray(raw)) throw new Error("registry is not a JSON array");
        rows = raw
          .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
          .map((r) => ({
            uuid: typeof r.uuid === "string" ? r.uuid : null,
            slug: typeof r.slug === "string" ? r.slug : null,
            dirName: typeof r.dirName === "string" ? r.dirName : typeof r.slug === "string" ? r.slug : "",
            scope: typeof r.scope === "string" ? r.scope : null,
            status: typeof r.status === "string" ? r.status : null,
            extra: r,
          }))
          .filter((r) => r.dirName);
        if (!rows.length) registry = { status: "empty", source: { path: regPath }, detail: "The registry lists no intents." };
      } catch (err) {
        registryProblems++;
        registry = { status: "error", source: { path: regPath }, detail: `intents.json could not be read: ${(err as Error).message}` };
      }
    } else {
      registry = { status: "missing", source: null, detail: "No intents.json registry in this space." };
    }
    let activeIntent: string | null = null;
    try {
      activeIntent = (await fs.readText(`${spaceRel}/intents/active-intent`, 4096)).text.trim() || null;
    } catch {
      /* optional */
    }
    // Union of registry rows and record folders on disk.
    const dirs = (await fs.list(`${spaceRel}/intents`)).filter((e) => e.isDir && !e.name.startsWith(".")).map((e) => e.name);
    const names = [...new Set([...rows.map((r) => r.dirName), ...dirs])];
    const intents = [];
    for (const dirName of names) {
      const row = rows.find((r) => r.dirName === dirName) ?? null;
      const exists = dirs.includes(dirName);
      if (!exists) {
        intents.push({
          key: dirName, uuid: row?.uuid ?? null, dirName, label: row?.slug ?? dirName, space: sp.name, scope: row?.scope ?? null,
          registryStatus: row?.status ?? null, lifecycle: "unknown" as const, recordedStatus: null, currentStage: null, progress: null,
          lastActivity: null, pending: [], dataStatus: "missing" as const, description: null, startedAt: null, active: activeIntent === dirName,
          issues: [{ severity: "warning" as const, message: "The registry lists this intent but its record folder is not in this checkout.", source: { path: regPath } }],
        });
        continue;
      }
      const detail = await buildIntent({ fs, space: sp.name, spaceRel, dirName, row, defs: defMap, defsSource, knownEvents: known.events, activeIntent });
      if (!row && rows.length) detail.issues.push({ severity: "info", message: "This record folder is not listed in the space's registry." });
      if (detail.dataStatus === "unsupported") stateUnsupported++;
      if (detail.shards.length) auditCount++;
      details.set(`${sp.name}/${dirName}`, detail);
      const { phases, events, decisions, artifacts, stateSections, shards, workflowStructureSource, ...summary } = detail;
      void phases, events, decisions, artifacts, stateSections, shards, workflowStructureSource;
      intents.push(summary);
      intentCount++;
    }
    intents.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || a.dirName.localeCompare(b.dirName));
    spaces.push({ name: sp.name, active: activeSpace === sp.name, intents, registry });
  }

  const recordsExist = await fs.exists("aidlc/spaces");
  caps.push(
    recordsExist
      ? { id: "spaces", label: "Spaces and intents", status: registryProblems ? "degraded" : "supported", detail: `${spaces.length} space(s), ${intentCount} intent record(s)${registryProblems ? `; ${registryProblems} registry file(s) unreadable` : ""}`, evidence: ["aidlc/spaces/*/intents/intents.json"] }
      : { id: "spaces", label: "Spaces and intents", status: "unavailable", detail: "No aidlc/spaces folder. Nothing has been recorded here yet, or this is not the workspace root.", evidence: [] },
  );
  caps.push({
    id: "state",
    label: "Stage progress",
    status: !intentCount ? "unavailable" : stateUnsupported === intentCount ? "unsupported" : stateUnsupported ? "degraded" : "supported",
    detail: !intentCount ? "No intents yet" : `aidlc-state.md State Version ${SUPPORTED_STATE_VERSIONS.join("/")}${stateUnsupported ? `; ${stateUnsupported} intent(s) use an unsupported version` : ""}`,
    evidence: ["aidlc/spaces/*/intents/*/aidlc-state.md"],
  });
  caps.push({ id: "audit", label: "Decisions and history", status: !intentCount ? "unavailable" : auditCount ? "supported" : "unavailable", detail: !intentCount ? "No intents yet" : `${auditCount} of ${intentCount} intent(s) have audit shards`, evidence: ["aidlc/spaces/*/intents/*/audit/*.md"] });
  caps.push({ id: "artifacts", label: "Artifacts", status: intentCount ? "supported" : "unavailable", detail: "Files under each intent's phase/stage folders (hidden engine folders excluded)", evidence: [] });
  caps.push({ id: "live", label: "Live refresh", status: "supported", detail: "File-change signals with debounce, plus a polling fallback", evidence: [] });
  caps.push({ id: "running-agent", label: "Live agent activity", status: "unsupported", detail: "Upstream does not record whether an agent is running right now. aidlc-ui shows the last recorded activity only.", evidence: [] });
  caps.push({ id: "interaction", label: "Approvals from the UI", status: "unsupported", detail: "Upstream has no supported external interaction contract. Approve and answer in your harness.", evidence: [] });

  // ---- compatibility level
  const version = selectedInfo?.frameworkVersion ?? null;
  let level: Compatibility["level"];
  let summary: string;
  if (!recordsExist && !selectedInfo) {
    level = "not-detected";
    summary = "No AI-DLC structures were found in this folder.";
  } else if (intentCount && stateUnsupported === intentCount) {
    level = "incompatible";
    summary = "Records were found, but their state format is not supported by this adapter. Nothing is shown as valid progress.";
  } else {
    const parsed = version ? /^(\d+)\.(\d+)\.(\d+)/.exec(version) : null;
    const designed = parsed ? Number(parsed[1]) === DESIGNED_FOR.major && Number(parsed[2]) >= DESIGNED_FOR.minMinor : false;
    const degraded = caps.some((c) => c.status === "degraded") || stateUnsupported > 0 || (selectedInfo !== null && defs.length === 0);
    if (version && TESTED_VERSIONS.includes(version) && !degraded) {
      level = "verified";
      summary = `AI-DLC ${version} is in aidlc-ui's tested set, and every record probe passed.`;
    } else if (!degraded && (designed || !version)) {
      level = "compatible";
      summary = version
        ? `AI-DLC ${version} has not been tested with aidlc-ui, but every record probe passed.`
        : "The records match the supported format. No installation version was found to compare.";
      if (version) issues.push({ severity: "info", message: `AI-DLC ${version} is not in the tested set (${TESTED_VERSIONS.join(", ")}). Data is shown because every schema probe passed.` });
    } else {
      level = "partial";
      summary = "Some data could not be read or is in an unexpected format. What can be read is shown, and the gaps are marked.";
      if (version && parsed && !designed) issues.push({ severity: "warning", message: `AI-DLC ${version} is outside the release line this adapter was built for (2.7+ on the 2.x line).` });
    }
    if (version && parsed && Number(parsed[1]) > DESIGNED_FOR.major) {
      level = level === "verified" || level === "compatible" ? "partial" : level;
      issues.push({ severity: "warning", message: `AI-DLC ${version} is a newer major version. aidlc-ui reads only what passes its schema probes.` });
    }
  }

  return {
    installations,
    selected: selectedInfo?.harnessDir ?? null,
    compatibility: { level, adapterId: ADAPTER_ID, adapterLabel: ADAPTER_LABEL, summary, issues, capabilities: caps, testedVersions: TESTED_VERSIONS },
    spaces,
    details,
  };
}
