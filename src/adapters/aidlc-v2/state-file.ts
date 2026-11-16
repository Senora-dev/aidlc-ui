/**
 * Parser for an intent's `aidlc-state.md` (AI-DLC 2.x, State Version 8).
 *
 * Grammar observed in real 2.10.0 / 2.11.4 / 2.11.5-preview records and in
 * the upstream `knowledge/aidlc-shared/state-template.md`:
 *
 *   # AI-DLC State Tracking
 *   ## <Section>
 *   - **<Field>**: <value>
 *   ## Stage Progress
 *   ### <PHASE NAME> PHASE
 *   - [<box>] <stage-slug> — <EXECUTE|SKIP|...>
 *
 * The parser is generic: it keeps every section and field it sees (unknown
 * ones included) and only interprets the few it needs. Nothing here assumes a
 * fixed list of phases or stages.
 */

export interface StateField {
  key: string;
  value: string;
  line: number;
}

export interface StateSection {
  title: string;
  line: number;
  fields: StateField[];
  /** Raw non-field lines (comments, prose), preserved. */
  other: string[];
}

export interface StageRow {
  box: string; // the single character inside [ ]
  slug: string;
  plan: string | null; // text after the dash, e.g. "EXECUTE"
  phaseHeading: string | null; // e.g. "IDEATION PHASE"
  line: number;
  raw: string;
}

export interface ParsedState {
  title: string | null;
  sections: StateSection[];
  stageRows: StageRow[];
  phaseHeadings: string[]; // in order of appearance under Stage Progress
  stateVersion: string | null;
  warnings: string[];
}

const FIELD_RE = /^\s*-\s+\*\*(.+?)\*\*:[ \t]?(.*)$/;
// Upstream writes an em dash; tolerate en dash and hyphen too.
const STAGE_RE = /^\s*-\s+\[(.)\]\s+([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s+[—–-]+\s+(.*?))?\s*$/;

export function parseStateFile(text: string): ParsedState {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: StateSection[] = [];
  const stageRows: StageRow[] = [];
  const phaseHeadings: string[] = [];
  const warnings: string[] = [];
  let title: string | null = null;
  let current: StateSection | null = null;
  let phaseHeading: string | null = null;

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      title ??= line.replace(/^#\s+/, "").trim();
      return;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2 && !/^###/.test(line)) {
      current = { title: h2[1], line: lineNo, fields: [], other: [] };
      sections.push(current);
      phaseHeading = null;
      return;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      phaseHeading = h3[1];
      if (current && /stage progress/i.test(current.title)) phaseHeadings.push(h3[1]);
      current?.other.push(line);
      return;
    }
    if (!current) return;
    const sec: StateSection = current;
    const stage = STAGE_RE.exec(line);
    if (stage && /stage progress/i.test(sec.title)) {
      stageRows.push({ box: stage[1], slug: stage[2], plan: stage[3]?.trim() || null, phaseHeading, line: lineNo, raw: line.trim() });
      return;
    }
    const field = FIELD_RE.exec(line);
    if (field) {
      sec.fields.push({ key: field[1].trim(), value: field[2].trim(), line: lineNo });
      return;
    }
    if (line.trim()) sec.other.push(line);
  });

  const versionMatch = /^- \*\*State Version\*\*:[ \t]*(\S+)[ \t]*$/m.exec(text);
  const stateVersion = versionMatch ? versionMatch[1] : null;
  if (!title) warnings.push("state file has no top-level title");
  return { title, sections, stageRows, phaseHeadings, stateVersion, warnings };
}

export function field(state: ParsedState, section: string | RegExp, key: string): string | null {
  for (const s of state.sections) {
    if (typeof section === "string" ? s.title.toLowerCase() === section.toLowerCase() : section.test(s.title)) {
      const f = s.fields.find((x) => x.key.toLowerCase() === key.toLowerCase());
      if (f) return f.value;
    }
  }
  return null;
}

export function anyField(state: ParsedState, key: string): string | null {
  for (const s of state.sections) {
    const f = s.fields.find((x) => x.key.toLowerCase() === key.toLowerCase());
    if (f) return f.value;
  }
  return null;
}

/** "IDEATION PHASE" -> "ideation"; "Operation" -> "operation". Unknown shapes are slugified. */
export function phaseIdFromHeading(heading: string): string {
  return heading
    .replace(/\s+phase\s*$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function titleCase(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Classify the State Version like upstream's classifyStateVersion, relative to the versions an adapter supports. */
export function classifyStateVersion(v: string | null, supported: string[]): "ok" | "unparseable" | "past" | "future" {
  if (v === null || !/^\d+$/.test(v)) return "unparseable";
  if (supported.includes(v)) return "ok";
  const max = Math.max(...supported.map(Number));
  return Number(v) > max ? "future" : "past";
}
