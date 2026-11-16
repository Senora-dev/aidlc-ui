import type { CapabilityStatus, CompatLevel, IntentSummary, NormalizedStageState } from "../../src/shared/model";

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.round((now - t) / 1000);
  if (s < 0) return "just now";
  if (s < 45) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}

export function absTime(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const STAGE_STATE: Record<NormalizedStageState, { label: string; tone: string; describe: string }> = {
  completed: { label: "Completed", tone: "done", describe: "Approved and completed ([x] in the state file)." },
  "in-progress": { label: "In progress", tone: "active", describe: "Recorded as in progress ([-]). This is the last recorded state, not proof an agent is running now." },
  "awaiting-approval": { label: "Awaiting approval", tone: "gate", describe: "The approval gate is open ([?]). Approve or request changes in your harness." },
  revising: { label: "Revising", tone: "revise", describe: "Changes were requested at the gate ([R]); the stage is being revised." },
  skipped: { label: "Skipped during run", tone: "skipped", describe: "Skipped while the work ran ([S]), by a skip or a jump." },
  "not-in-plan": { label: "Not in plan", tone: "muted", describe: "The plan leaves this stage out (SKIP). It never ran." },
  pending: { label: "Pending", tone: "pending", describe: "In the plan, not started yet ([ ] EXECUTE)." },
  unknown: { label: "Unknown", tone: "unknown", describe: "The recorded value is not one aidlc-ui recognises. The raw value is shown." },
};

export const LIFECYCLE: Record<IntentSummary["lifecycle"], { label: string; tone: string }> = {
  "in-flight": { label: "In flight", tone: "active" },
  complete: { label: "Complete", tone: "done" },
  archived: { label: "Archived", tone: "muted" },
  parked: { label: "Parked", tone: "pending" },
  unknown: { label: "Unknown status", tone: "unknown" },
};

export const COMPAT: Record<CompatLevel, { label: string; tone: string }> = {
  verified: { label: "Verified", tone: "done" },
  compatible: { label: "Compatible · untested version", tone: "active" },
  partial: { label: "Partial", tone: "gate" },
  incompatible: { label: "Incompatible", tone: "danger" },
  "not-detected": { label: "Not detected", tone: "muted" },
};

export const CAP: Record<CapabilityStatus, { label: string; tone: string }> = {
  supported: { label: "Available", tone: "done" },
  degraded: { label: "Degraded", tone: "gate" },
  unavailable: { label: "Unavailable", tone: "muted" },
  unsupported: { label: "Not supported", tone: "unknown" },
};

export function humanize(s: string): string {
  return s.replace(/[_-]+/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : p;
}
