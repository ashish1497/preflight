// Per-product customs data from the UK government Trade Tariff service (server-side).
// - EU import side: the "xi" tariff, which applies EU customs rules (TARIC).
// - UK export side: the "uk" tariff.
// Advisory only: shown alongside the fixed checks, never used to block a booking.

const BASE = "https://www.trade-tariff.service.gov.uk";

export const ISO: Record<string, string> = {
  "United Kingdom": "GB",
  China: "CN",
  India: "IN",
  Vietnam: "VN",
  Turkey: "TR",
  Germany: "DE",
  France: "FR",
  Netherlands: "NL",
};

export interface TariffDoc {
  code: string;
  description: string;
}
export interface TariffControl {
  type: string;
  /** Documents that satisfy the control (any one of them). */
  documents: TariffDoc[];
  /** Statements that the control doesn't apply (Y-codes). */
  waivers: TariffDoc[];
  /** True if every sub-code under this commodity code has it. */
  allSubcodes: boolean;
}
/** A prohibition or restriction measure (may have no documents at all). */
export interface TariffRestriction {
  type: string;
  allSubcodes: boolean;
}
export interface TariffDuty {
  label: string;
  rate: string;
  note?: string;
  allSubcodes: boolean;
}
export interface TariffResult {
  code: string;
  apiCode: string;
  subcodes: string[];
  origin: string;
  dest: string;
  euImport: { duties: TariffDuty[]; controls: TariffControl[]; restrictions?: TariffRestriction[] };
  ukExport: { controls: TariffControl[]; restrictions?: TariffRestriction[] };
  links: { eu: string; uk: string };
}

// Measure types we treat as duties (everything else with documents is a control).
const DUTY_TYPES: Record<string, string> = {
  "103": "Standard (third country) duty",
  "142": "Preferential duty",
  "143": "Preferential tariff quota",
  "551": "Provisional anti-dumping duty",
  "552": "Anti-dumping duty",
  "553": "Provisional countervailing duty",
  "554": "Countervailing duty",
  "695": "Additional duty",
  "696": "Additional duty",
};
const IGNORE_TYPES = new Set(["105", "107", "117", "119", "122", "123", "305", "306", "109", "110", "111", "112", "115"]); // low-value, end-use reliefs, VAT/excise, quotas

/** The tariff service wants 10 digits. Listed codes for chapters 01–09 have 7 digits (no leading zero). */
export function toApiCode(listCode: string): string {
  const eight = listCode.length === 7 ? "0" + listCode : listCode.slice(0, 8);
  return eight + "00";
}

type Json = { data: { id: string; type: string; attributes: Record<string, unknown>; relationships?: Record<string, { data: unknown }> }; included?: Inc[] };
type Inc = { id: string; type: string; attributes: Record<string, unknown>; relationships?: Record<string, { data: unknown }> };

const cache = new Map<string, Promise<Json | null>>();
function getJson(path: string): Promise<Json | null> {
  if (!cache.has(path))
    cache.set(
      path,
      fetch(BASE + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => {
          cache.delete(path); // don't remember network failures
          return null;
        }),
    );
  return cache.get(path)!;
}

/** Leaf commodity codes for a code: itself if declarable, else its sub-codes (max 6). */
async function leaves(side: "uk" | "xi", code10: string): Promise<{ id: string; json: Json }[]> {
  const direct = await getJson(`/${side}/api/commodities/${code10}`);
  if (direct) return [{ id: code10, json: direct }];
  const sub = await getJson(`/${side}/api/subheadings/${code10}-80`);
  if (!sub) return [];
  const ids = (sub.included ?? [])
    .filter((i) => i.type === "commodity" && i.attributes.leaf)
    .map((i) => String(i.attributes.goods_nomenclature_item_id))
    .slice(0, 6);
  const out = await Promise.all(ids.map(async (id) => ({ id, json: await getJson(`/${side}/api/commodities/${id}`) })));
  return out.filter((x): x is { id: string; json: Json } => !!x.json);
}

const strip = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const rel = (i: Inc, k: string) => i.relationships?.[k]?.data as { id: string; type: string } | { id: string; type: string }[] | undefined;

interface Measure {
  key: string;
  type: string;
  typeDesc: string;
  isImport: boolean;
  appliesTo: (iso: string) => boolean;
  geoLabel: string;
  duty: string;
  docs: TariffDoc[];
  waivers: TariffDoc[];
}

function measures(json: Json): Measure[] {
  const inc = new Map((json.included ?? []).map((i) => [`${i.type}:${i.id}`, i]));
  const get = (t: string, id: string) => inc.get(`${t}:${id}`);
  const out: Measure[] = [];
  for (const m of json.included ?? []) {
    if (m.type !== "measure") continue;
    const mt = rel(m, "measure_type") as { id: string } | undefined;
    if (!mt || IGNORE_TYPES.has(mt.id)) continue;
    const geoRef = rel(m, "geographical_area") as { id: string } | undefined;
    const geo = geoRef ? get("geographical_area", geoRef.id) : undefined;
    const children = new Set(((geo?.relationships?.children_geographical_areas?.data as { id: string }[]) ?? []).map((c) => c.id));
    const excluded = new Set(((rel(m, "excluded_countries") as { id: string }[]) ?? []).map((c) => c.id));
    const geoId = geoRef?.id ?? "";
    const conds = ((rel(m, "measure_conditions") as { id: string }[]) ?? []).map((c) => get("measure_condition", c.id)?.attributes ?? {});
    const docs: TariffDoc[] = [], waivers: TariffDoc[] = [];
    for (const c of conds) {
      const code = String(c.document_code ?? "");
      if (!code) continue;
      const list = code.startsWith("Y") ? waivers : docs;
      if (!list.some((d) => d.code === code)) list.push({ code, description: strip(c.certificate_description) });
    }
    const de = rel(m, "duty_expression") as { id: string } | undefined;
    const duty = strip(m.attributes.resolved_duty_expression) || strip(de ? get("duty_expression", de.id)?.attributes.base : "");
    out.push({
      key: `${m.attributes.import ? "I" : "E"}|${mt.id}|${geoId}|${docs.map((d) => d.code).join(",")}`,
      type: mt.id,
      typeDesc: strip(get("measure_type", mt.id)?.attributes.description),
      isImport: !!m.attributes.import,
      appliesTo: (iso) => !excluded.has(iso) && (geoId === iso || children.has(iso)),
      geoLabel: strip(geo?.attributes.description) || geoId,
      duty,
      docs,
      waivers,
    });
  }
  return out;
}

/** Combine measures across sub-codes; note which ones hold for every sub-code. */
function merged(all: Measure[][]) {
  const count = new Map<string, number>();
  const first = new Map<string, Measure>();
  for (const ms of all)
    for (const k of new Set(ms.map((m) => m.key))) {
      count.set(k, (count.get(k) ?? 0) + 1);
      if (!first.has(k)) first.set(k, ms.find((m) => m.key === k)!);
    }
  return [...first.values()].map((m) => ({ m, all: count.get(m.key) === all.length }));
}

function controlsFor(list: { m: Measure; all: boolean }[], iso: string, isImport: boolean): TariffControl[] {
  const seen = new Set<string>();
  return list
    .filter(({ m }) => m.isImport === isImport && !DUTY_TYPES[m.type] && m.docs.length && m.appliesTo(iso))
    .map(({ m, all }) => ({ type: m.typeDesc, documents: m.docs, waivers: m.waivers, allSubcodes: all }))
    .filter((c) => {
      const k = c.type + c.documents.map((d) => d.code).join();
      return seen.has(k) ? false : (seen.add(k), true);
    });
}

/** Measures that prohibit or restrict entry/exit, whether or not a document can lift them. */
export const RESTRICTION_RE = /prohibit|restriction on (entry|export)/i;
function restrictionsFor(list: { m: Measure; all: boolean }[], iso: string, isImport: boolean): TariffRestriction[] {
  const seen = new Set<string>();
  return list
    .filter(({ m }) => m.isImport === isImport && !DUTY_TYPES[m.type] && RESTRICTION_RE.test(m.typeDesc) && m.appliesTo(iso))
    .map(({ m, all }) => ({ type: m.typeDesc, allSubcodes: all }))
    .filter((r) => (seen.has(r.type) ? false : (seen.add(r.type), true)));
}

export async function lookupTariff(listCode: string, origin: string, dest: string): Promise<TariffResult | null> {
  const apiCode = toApiCode(listCode);
  const originIso = ISO[origin] ?? "";
  const destIso = ISO[dest] ?? "";
  const [xi, uk] = await Promise.all([leaves("xi", apiCode), leaves("uk", apiCode)]);
  if (!xi.length && !uk.length) return null;

  const xiList = merged(xi.map((l) => measures(l.json)));
  const ukList = merged(uk.map((l) => measures(l.json)));

  // EU import duty for the goods' country of origin.
  const duties: TariffDuty[] = [];
  const std = xiList.find(({ m }) => m.isImport && m.type === "103" && m.appliesTo(originIso || "CN"));
  if (std) duties.push({ label: DUTY_TYPES["103"], rate: std.m.duty || "see tariff", allSubcodes: std.all });
  if (originIso && originIso !== "DE") {
    for (const { m, all } of xiList) {
      if (!m.isImport || !DUTY_TYPES[m.type] || m.type === "103" || !m.appliesTo(originIso)) continue;
      duties.push({
        label: `${DUTY_TYPES[m.type]} (${origin})`,
        rate: m.duty || "see tariff",
        note: m.type === "142" && originIso === "GB" ? "Needs the statement on origin on the invoice (Preflight adds it)." : m.docs.length ? `Needs: ${m.docs.map((d) => d.code).join(", ")}` : undefined,
        allSubcodes: all,
      });
    }
  }

  return {
    code: listCode,
    apiCode,
    subcodes: xi.map((l) => l.id),
    origin,
    dest,
    euImport: { duties, controls: controlsFor(xiList, originIso, true), restrictions: restrictionsFor(xiList, originIso, true) },
    ukExport: { controls: controlsFor(ukList, destIso, false), restrictions: restrictionsFor(ukList, destIso, false) },
    links: { eu: `${BASE}/xi/commodities/${xi[0]?.id ?? apiCode}`, uk: `${BASE}/commodities/${uk[0]?.id ?? apiCode}` },
  };
}
