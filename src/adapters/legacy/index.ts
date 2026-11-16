/**
 * Detector for layouts aidlc-ui recognises but does not parse.
 *
 * AI-DLC 0.x / 1.x kept a single workflow in `aidlc-docs/` (aidlc-state.md,
 * audit.md) at the project root. aidlc-ui does not read that format: it is
 * reported as detected-but-unsupported instead of being shown as valid data.
 */
import type { RootFs } from "../../server/fsguard.js";

export interface LegacyDetection {
  kind: "aidlc-docs-v1";
  evidence: string[];
}

export async function detectLegacy(fs: RootFs): Promise<LegacyDetection | null> {
  const evidence: string[] = [];
  for (const p of ["aidlc-docs/aidlc-state.md", "aidlc-docs/audit.md"]) if (await fs.exists(p)) evidence.push(p);
  return evidence.length ? { kind: "aidlc-docs-v1", evidence } : null;
}
