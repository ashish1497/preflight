// Commodity code lookup. Source of truth: HMRC Combined Nomenclature 2026 (public/data/hs.json),
// with codes exactly as published there (7 or 8 digits). We never pad or extend a code.

export interface HsLookup {
  codes: Record<string, string>;
}

export interface HsMatch {
  code: string;
  description: string;
}

export interface HsInfo {
  /** The code is in the tariff list exactly as given. */
  exact: boolean;
  /** Description when exact; otherwise null. */
  description: string | null;
  /** Tariff-list codes that start with the given digits (includes the exact one). */
  matches: HsMatch[];
}

/** Strip everything but digits ("6912.00" → "691200"). */
export function normalizeHs(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === "number" ? String(Math.trunc(raw)) : String(raw);
  const digits = s.replace(/\D/g, "");
  return digits.length ? digits : null;
}

const cache = new WeakMap<HsLookup, string[]>();
const sortedCodes = (hs: HsLookup) => {
  let c = cache.get(hs);
  if (!c) cache.set(hs, (c = Object.keys(hs.codes).sort()));
  return c;
};

/** Tariff-list codes starting with `prefix`, exactly as listed. */
export function hsMatches(prefix: string | null, hs: HsLookup | null, limit = 50): HsMatch[] {
  if (!prefix || !hs) return [];
  const out: HsMatch[] = [];
  for (const k of sortedCodes(hs)) {
    if (k.startsWith(prefix)) out.push({ code: k, description: hs.codes[k] });
    if (out.length >= limit) break;
  }
  return out;
}

export function describeHs(code: string | null, hs: HsLookup | null): HsInfo {
  if (!code || !hs) return { exact: false, description: null, matches: [] };
  const description = hs.codes[code] ?? null;
  return { exact: description !== null, description, matches: hsMatches(code, hs) };
}

/**
 * Map an AI-suggested code onto the tariff list. The list writes chapter 01–09 codes without the
 * leading zero (e.g. coffee is 9012100), so a suggestion like "090121" is looked up as "90121".
 * Returns only codes that exist in the list.
 */
export function matchSuggestion(code: string | null, hs: HsLookup | null): HsMatch[] {
  if (!code || !hs) return [];
  const direct = hsMatches(code, hs);
  if (direct.length || !code.startsWith("0")) return direct;
  return hsMatches(code.replace(/^0+/, ""), hs);
}

/** HS prefixes for goods not accepted on road groupage (lithium batteries, aerosols, flammable liquids/gases). Every prefix exists in public/data/hs.json. */
export const DG_HS_PREFIXES: { prefix: string; label: string }[] = [
  { prefix: "850650", label: "lithium primary cells/batteries" },
  { prefix: "850760", label: "lithium-ion batteries" },
  { prefix: "3303", label: "perfumes and toilet waters (flammable liquid)" },
  { prefix: "330749", label: "room fragrance / diffuser liquids (usually flammable)" },
  { prefix: "3605", label: "matches" },
  { prefix: "3606", label: "lighter fuel / pyrophoric alloys" },
  { prefix: "2207", label: "ethyl alcohol (flammable liquid)" },
  { prefix: "2710", label: "petroleum oils / fuels (flammable liquid)" },
  { prefix: "3814", label: "organic solvents and thinners (flammable liquid)" },
];
