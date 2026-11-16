/**
 * Adapter registry. Chooses how to read a workspace and produces the
 * version-neutral snapshot the UI consumes. Version-specific knowledge lives
 * only inside individual adapters.
 */
import type { CliProbe, IntentDetail, WorkspaceSnapshot } from "../shared/model.js";
import { MODEL_VERSION } from "../shared/model.js";
import type { RootFs } from "../server/fsguard.js";
import * as v2 from "./aidlc-v2/index.js";
import { detectLegacy } from "./legacy/index.js";

export interface ScanResult {
  snapshot: Omit<WorkspaceSnapshot, "id" | "name" | "root" | "demo" | "refreshedAt" | "lastSuccessAt" | "lastError" | "revision" | "dataStatus">;
  details: Map<string, IntentDetail>;
}

export async function scanWorkspace(fs: RootFs, opts: { preferredHarness: string | null; cli: CliProbe | null }): Promise<ScanResult> {
  const probe = await v2.probe(fs);
  const legacy = await detectLegacy(fs);
  const result = await v2.scan(fs, opts.preferredHarness);
  const compat = result.compatibility;

  if (legacy && !probe.records) {
    compat.level = "incompatible";
    compat.summary = "This folder uses the AI-DLC 1.x layout (aidlc-docs/). aidlc-ui reads 2.x records only, so none of this data is shown as valid.";
    compat.issues.unshift({
      severity: "error",
      message: `Detected ${legacy.evidence.join(", ")} (AI-DLC 1.x layout). aidlc-ui does not read or convert it.`,
      action: "Upgrading is your decision. aidlc-ui never migrates records.",
    });
  } else if (legacy) {
    compat.issues.push({ severity: "info", message: `A legacy aidlc-docs/ folder is also present (${legacy.evidence.join(", ")}). It is ignored.` });
  }

  // Version skew between the project's projected installation and the CLI on PATH.
  const selected = result.installations.find((i) => i.harnessDir === result.selected);
  if (opts.cli?.found && opts.cli.binaryVersion && selected?.frameworkVersion && opts.cli.binaryVersion !== selected.frameworkVersion) {
    compat.issues.push({
      severity: "info",
      message: `This project is configured with AI-DLC ${selected.frameworkVersion}, but the aidlc command on PATH is ${opts.cli.binaryVersion}.`,
      action: "Upstream treats this as version skew; `aidlc config` refreshes the project when you are ready. aidlc-ui never changes your installation.",
    });
  }
  compat.capabilities.push(
    opts.cli?.attempted
      ? { id: "cli", label: "aidlc command on PATH", status: opts.cli.found ? "supported" : "unavailable", detail: opts.cli.detail, evidence: ["aidlc version"] }
      : { id: "cli", label: "aidlc command on PATH", status: "unavailable", detail: "Not checked (disabled with --no-cli-probe, or demo mode)", evidence: [] },
  );

  return {
    snapshot: {
      modelVersion: MODEL_VERSION,
      installations: result.installations,
      selectedInstallation: result.selected,
      cli: opts.cli,
      compatibility: compat,
      spaces: result.spaces,
    },
    details: result.details,
  };
}
