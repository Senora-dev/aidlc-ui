// Dev helper: print what the adapter reads from a workspace.  npx tsx scripts/dev/inspect.ts <root> [space/intent]
import { RootFs } from "../../src/server/fsguard.js";
import { scanWorkspace } from "../../src/adapters/index.js";
const root = process.argv[2];
const r = await scanWorkspace(new RootFs(root), { preferredHarness: null, cli: null });
const c = r.snapshot.compatibility;
console.log("level:", c.level, "|", c.summary);
for (const i of c.issues) console.log("  issue", i.severity, i.message);
for (const cap of c.capabilities) console.log("  cap", cap.id, cap.status, "-", cap.detail);
for (const s of r.snapshot.spaces) for (const i of s.intents)
  console.log(s.name, i.dirName, i.lifecycle, "|", i.recordedStatus, "| cur:", i.currentStage?.slug, "|", `${i.progress?.completed}/${i.progress?.planned}`, "| pending:", i.pending.map((p) => `${p.kind}:${p.title}`).join("; "), "|", i.dataStatus, i.lastActivity);
const key = process.argv[3];
if (key) {
  const d = r.details.get(key)!;
  for (const p of d.phases) console.log(`[${p.id} ${p.status}]`, p.stages.map((s) => `${s.slug}:${s.state}${s.custom ? "*" : ""}${s.attention.length ? "!" : ""}(${s.artifacts.length})`).join(" "));
  for (const x of d.decisions) console.log("  dec", x.kind, x.stage, x.answerState, "|", x.title.slice(0, 60), "| choice:", x.choice, "| reply:", x.personReply, x.unordered ? "UNORDERED" : "");
  console.log("events", d.events.length, "artifacts", d.artifacts.length, d.progress?.basis, d.progress?.mismatch);
}
