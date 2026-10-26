// Maps pre-flight issues onto booking-sheet fields, so each field can show its own state
// (docs/execution-plan.md §2.2) and each section its own badge.
import type { FieldState } from "@/components/ui";
import type { Analysis, Issue, Item } from "./types";

/** Booking fields use their key ("declaredValue"); item fields use "items[i].field". */
export type FieldKey = string;
export const itemKey = (i: number, field: keyof Item): FieldKey => `items[${i}].${field}`;

/** The 11 pre-flight checks the meter counts. */
export const CHECK_IDS = ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09", "R-10", "D-01"] as const;

const ITEM_FIELDS: Record<string, (keyof Item)[]> = {
  "R-01": ["hsCode"],
  "R-03": ["unitsPerCarton", "cartons", "quantity"],
  "R-06": ["description"],
  "R-09": ["countryOfOrigin"],
  "D-01": ["description"],
};
const BOOKING_FIELDS: Record<string, FieldKey[]> = {
  "R-02": ["declaredValue"],
  "R-04": ["cartons"],
  "R-05": ["pallets", "grossWeight"],
  "R-07": ["grossWeight"],
  "R-08": ["appointment"],
  "R-10": ["readyDate"],
};
/** Labels used in the DATA "Missing: …" title (rules.ts) → field. */
const DATA_FIELDS: Record<string, FieldKey> = {
  destination: "destCity",
  pallets: "pallets",
  "total gross weight": "grossWeight",
  "total cartons": "cartons",
  "total declared value": "declaredValue",
};
/** A check can't pass while the data it needs is missing. */
const DATA_BLOCKS: Record<FieldKey, string[]> = {
  destCity: ["R-05"],
  pallets: ["R-05"],
  grossWeight: ["R-05", "R-07"],
  cartons: ["R-04"],
  declaredValue: ["R-02"],
  items: ["R-01", "R-02", "R-03", "R-04", "R-06", "R-07", "R-09", "D-01"],
};

/** Fields an issue points at. */
export function issueFields(issue: Issue): FieldKey[] {
  if (issue.rule === "DATA") {
    if (/^No items/i.test(issue.title)) return ["items"];
    const m = issue.title.match(/^Missing:\s*(.+)$/i);
    if (!m) return [];
    return m[1].split(",").map((s) => DATA_FIELDS[s.trim().toLowerCase()]).filter((f): f is FieldKey => !!f);
  }
  const keys: FieldKey[] = [...(BOOKING_FIELDS[issue.rule] ?? [])];
  if (issue.itemIndex != null) for (const f of ITEM_FIELDS[issue.rule] ?? []) keys.push(itemKey(issue.itemIndex, f));
  return keys;
}

const cache = new WeakMap<Analysis, Map<FieldKey, Issue[]>>();
/** Every issue keyed by the field(s) it points at (red first, then amber, then info). */
export function fieldIssues(analysis: Analysis): Map<FieldKey, Issue[]> {
  const hit = cache.get(analysis);
  if (hit) return hit;
  const map = new Map<FieldKey, Issue[]>();
  for (const issue of analysis.issues)
    for (const key of issueFields(issue)) {
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    }
  cache.set(analysis, map);
  return map;
}

/** Fields that must be filled before the booking can go. Everything else may be blank. */
const REQUIRED_BOOKING = new Set(["originCity", "destCity", "destType", "readyDate", "pallets", "cartons", "declaredValue", "grossWeight"]);
const REQUIRED_ITEM = new Set<string>(["description", "hsCode", "quantity", "unitPrice", "unitsPerCarton", "cartons", "unitWeight", "countryOfOrigin"]);
/** Fields some check looks at; filled + no issue = verified. Others stay plain. */
const CHECKED_BOOKING = new Set(["destCity", "declaredValue", "cartons", "pallets", "grossWeight", "appointment", "readyDate"]);
const CHECKED_ITEM = new Set<string>(["hsCode", "unitsPerCarton", "cartons", "quantity", "description", "countryOfOrigin"]);

const itemField = (key: FieldKey) => key.match(/^items\[\d+\]\.(\w+)$/)?.[1];
export const isRequired = (key: FieldKey) => {
  const f = itemField(key);
  return f ? REQUIRED_ITEM.has(f) : REQUIRED_BOOKING.has(key);
};
const isChecked = (key: FieldKey) => {
  const f = itemField(key);
  return f ? CHECKED_ITEM.has(f) : CHECKED_BOOKING.has(key);
};
const isEmpty = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/**
 * State of one field: error (red issue) › warning (amber issue) › missing (required and blank)
 * › suggested (AI or calculated value) › verified (filled and checked) › plain.
 * A blank field whose only red issue is "Missing details" shows as missing, not error.
 */
export function stateFor(key: FieldKey, value: unknown, analysis: Analysis, opts: { suggested?: boolean; required?: boolean } = {}): FieldState {
  const issues = fieldIssues(analysis).get(key) ?? [];
  const empty = isEmpty(value);
  const required = opts.required ?? isRequired(key);
  if (issues.some((i) => i.severity === "red" && !(empty && i.rule === "DATA"))) return "error";
  if (issues.some((i) => i.severity === "amber")) return "warning";
  if (empty) return required || issues.length ? "missing" : "plain";
  if (opts.suggested) return "suggested";
  return isChecked(key) ? "verified" : "plain";
}

/** The issue to show under a field in the given state (first red for error, first amber for warning). */
export function messageFor(key: FieldKey, analysis: Analysis, state: FieldState): Issue | undefined {
  if (state !== "error" && state !== "warning") return undefined;
  const sev = state === "error" ? "red" : "amber";
  return fieldIssues(analysis).get(key)?.find((i) => i.severity === sev);
}

/** Pre-flight meter: checks with no red/amber issue and nothing missing that they need. */
export function meter(analysis: Analysis): { passed: number; total: number; failing: string[] } {
  const failing = new Set<string>();
  for (const i of analysis.issues) {
    if (i.severity === "info") continue;
    if (i.rule === "DATA") for (const f of issueFields(i)) for (const r of DATA_BLOCKS[f] ?? []) failing.add(r);
    else failing.add(i.rule);
  }
  const list = CHECK_IDS.filter((id) => failing.has(id));
  return { passed: CHECK_IDS.length - list.length, total: CHECK_IDS.length, failing: list };
}

// ---------------------------------------------------------------- sections
export type SectionId = "route" | "goods" | "load" | "dates";
const SECTION_OF = (key: FieldKey): SectionId | null => {
  if (key === "items" || key.startsWith("items[")) return "goods";
  if (["originCity", "destCity", "destCountry", "destType"].includes(key)) return "route";
  if (["pallets", "cartons", "declaredValue", "grossWeight"].includes(key)) return "load";
  if (["readyDate", "neededBy", "priority", "incoterm", "appointment"].includes(key)) return "dates";
  return null;
};

/** Distinct red/amber issues per section, plus the required fields still blank. */
export function sectionStatus(analysis: Analysis, section: SectionId): { red: Issue[]; amber: Issue[]; missing: FieldKey[] } {
  const seen = new Set<Issue>();
  for (const [key, list] of fieldIssues(analysis)) if (SECTION_OF(key) === section) list.forEach((i) => seen.add(i));
  const all = [...seen];
  const b = analysis.booking;
  const missing: FieldKey[] = [];
  if (section === "goods") {
    if (!b.items.length) missing.push("items");
    b.items.forEach((it, i) => {
      for (const f of REQUIRED_ITEM) if (isEmpty(it[f as keyof Item])) missing.push(itemKey(i, f as keyof Item));
    });
  } else {
    for (const f of REQUIRED_BOOKING) if (SECTION_OF(f) === section && isEmpty(b[f as keyof typeof b])) missing.push(f);
  }
  // "Missing details" on a blank field is already counted as missing, not as something to fix.
  const onlyMissing = (i: Issue) => i.rule === "DATA" && issueFields(i).filter((k) => SECTION_OF(k) === section).every((k) => missing.includes(k));
  const counted = all.filter((i) => !onlyMissing(i));
  return { red: counted.filter((i) => i.severity === "red"), amber: counted.filter((i) => i.severity === "amber"), missing };
}
