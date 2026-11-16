/**
 * Reader for an intent's audit trail (`<record>/audit/<writer>.md` shards).
 *
 * Grammar (upstream `knowledge/aidlc-shared/audit-format.md` and
 * `core/tools/aidlc-record-core.ts` @ v2.11.4):
 *  - a shard is split on "\n---\n" into blocks;
 *  - a block is an event when it holds a `**Timestamp**:` and an `**Event**:`
 *    line; the FIRST occurrence of a field wins (older versions could write
 *    duplicates);
 *  - free-form notes are blocks with a heading and prose but no Event line;
 *  - within one shard, position orders rows; across shards, rows with the same
 *    (second-resolution) timestamp have no known order ("unordered");
 *  - a HOST_TURN naming a Message Id withdraws an earlier HUMAN_TURN with that id;
 *  - a copied shard (sync-tool conflict copy) repeats another shard's rows; a
 *    row found in several files that start with the same first block is read once.
 *
 * This module never writes, and treats every value as untrusted text.
 */
import type { AuditEvent, SourceRef } from "../../shared/model.js";

export interface ShardText {
  path: string; // workspace-relative
  content: string;
}

export interface ParsedBlock {
  pos: number;
  raw: string;
  heading: string | null;
  fields: Array<[string, string]>;
  body: string | null;
}

const FIELD_RE = /^(?:- )?\*\*(.+?)\*\*:[ \t]?(.*)$/;
export const SHARD_NAME_RE = /^[a-z0-9][a-z0-9-]*-[a-z0-9]{1,32}\.md$/;

export function splitBlocks(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split(/\n---\n/);
}

export function parseBlock(raw: string, pos: number): ParsedBlock {
  const fields: Array<[string, string]> = [];
  const body: string[] = [];
  let heading: string | null = null;
  for (const line of raw.split("\n")) {
    if (/^# AI-DLC Audit Log\s*$/.test(line)) continue;
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h && heading === null && fields.length === 0) {
      heading = h[1];
      continue;
    }
    const f = FIELD_RE.exec(line);
    if (f) {
      fields.push([f[1].trim(), f[2].trim()]);
      continue;
    }
    if (line.trim() || body.length) body.push(line);
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  return { pos, raw, heading, fields, body: body.length ? body.join("\n") : null };
}

export function firstField(fields: Array<[string, string]>, name: string): string | null {
  const hit = fields.find(([k]) => k === name);
  return hit ? hit[1] : null;
}

export interface ReadOptions {
  knownEvents: ReadonlySet<string>;
}

export interface AuditRead {
  events: AuditEvent[];
  notes: AuditEvent[];
  shards: Array<{ path: string; events: number; readable: boolean }>;
  copiedRows: number;
}

/** Positions inside one shard of HUMAN_TURN rows a later HOST_TURN took back. */
function withdrawnTurns(blocks: ParsedBlock[]): Set<number> {
  const out = new Set<number>();
  const takenBack = new Set<string>();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const ev = firstField(blocks[i].fields, "Event");
    if (ev !== "HOST_TURN" && ev !== "HUMAN_TURN") continue;
    const id = firstField(blocks[i].fields, "Message Id");
    if (!id) continue;
    if (ev === "HOST_TURN") takenBack.add(id);
    else if (takenBack.has(id)) out.add(i);
  }
  return out;
}

export function readAudit(shards: ShardText[], opts: ReadOptions): AuditRead {
  const parsed = shards.map((s) => splitBlocks(s.content).map((b, i) => parseBlock(b, i)));

  // Copy detection: group shards by identical first block (header + first row).
  const skip = shards.map(() => new Set<number>());
  let copiedRows = 0;
  const groups = new Map<string, number[]>();
  shards.forEach((s, idx) => {
    const first = splitBlocks(s.content)[0] ?? "";
    if (!/\*\*Timestamp\*\*:/.test(first)) return;
    const list = groups.get(first) ?? [];
    list.push(idx);
    groups.set(first, list);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Prefer a properly named shard, then the one with more rows, then name order.
    const ranked = [...members].sort((a, b) => {
      const an = SHARD_NAME_RE.test(basename(shards[a].path)) ? 0 : 1;
      const bn = SHARD_NAME_RE.test(basename(shards[b].path)) ? 0 : 1;
      if (an !== bn) return an - bn;
      if (parsed[b].length !== parsed[a].length) return parsed[b].length - parsed[a].length;
      return shards[a].path.localeCompare(shards[b].path);
    });
    const seen = new Set<string>();
    for (const idx of ranked) {
      parsed[idx].forEach((blk) => {
        if (!/\*\*Timestamp\*\*:/.test(blk.raw)) return;
        if (seen.has(blk.raw)) {
          skip[idx].add(blk.pos);
          copiedRows++;
        } else seen.add(blk.raw);
      });
    }
  }

  const events: AuditEvent[] = [];
  const notes: AuditEvent[] = [];
  const shardInfo: AuditRead["shards"] = [];
  shards.forEach((s, shardIndex) => {
    const blocks = parsed[shardIndex];
    const withdrawn = withdrawnTurns(blocks);
    let count = 0;
    for (const blk of blocks) {
      if (skip[shardIndex].has(blk.pos)) continue;
      const type = firstField(blk.fields, "Event");
      const ts = firstField(blk.fields, "Timestamp");
      const source: SourceRef = { path: s.path, block: blk.pos };
      const base = {
        id: `${shardIndex}:${blk.pos}`,
        heading: blk.heading,
        timestamp: ts,
        stage: firstField(blk.fields, "Stage") ?? firstField(blk.fields, "Stage slug"),
        fields: blk.fields.filter(([k]) => k !== "Event" && k !== "Timestamp"),
        body: blk.body,
        shard: s.path,
        pos: blk.pos,
        unordered: false,
        source,
      };
      if (type && ts) {
        count++;
        events.push({ ...base, type, withdrawn: withdrawn.has(blk.pos), known: opts.knownEvents.has(type) });
      } else if (blk.heading && (blk.body || blk.fields.length) && !/^AI-DLC Audit Log$/.test(blk.heading)) {
        // A free-form note (upstream reports these as NOTE entries).
        notes.push({ ...base, type: "NOTE", withdrawn: false, known: true });
      }
    }
    shardInfo.push({ path: s.path, events: count, readable: true });
  });

  // Order: timestamp, then shard, then position. Mark cross-shard same-second ties.
  const order = (a: AuditEvent, b: AuditEvent) =>
    (a.timestamp ?? "").localeCompare(b.timestamp ?? "") || a.shard.localeCompare(b.shard) || a.pos - b.pos;
  events.sort(order);
  const byTs = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.timestamp) continue;
    const set = byTs.get(e.timestamp) ?? new Set<string>();
    set.add(e.shard);
    byTs.set(e.timestamp, set);
  }
  for (const e of events) {
    if (e.timestamp && (byTs.get(e.timestamp)?.size ?? 0) > 1) e.unordered = true;
  }
  notes.sort(order);
  return { events, notes, shards: shardInfo, copiedRows };
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}
