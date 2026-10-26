// Compliance checklist (docs/execution-plan.md §4.4): what has to happen, by whom and when, for one booking.
// Severity policy: blocker = data errors / not accepted on service (the existing red checks) · warning =
// prohibitions, licences with no waiver, anti-dumping/countervailing duty · task = owner + deadline ·
// advisory = legal/market rules, never blocks. Nothing here changes the booking status.
import { neededFromYou } from "./confirm";
import { RULES, effectiveIncoterm, ruleName } from "./reference";
import { RESTRICTION_RE, type TariffControl, type TariffResult } from "./tariff";
import type { Analysis, Booking, Issue, Item } from "./types";

export type Stage = "booking" | "collection" | "border" | "after";
export type ItemType = "blocker" | "warning" | "task" | "advisory";
export type Owner = "You" | "Receiver" | "Carrier" | "Broker";

export interface ChecklistItem {
  id: string;
  stage: Stage;
  type: ItemType;
  owner: Owner;
  title: string;
  why: string;
  consequence?: string;
  source?: { label: string; url: string };
  done?: boolean;
  /** "confirm": seller ticks it (stored in booking.confirmations[key]); "field": points at a booking field to fill. */
  action?: { kind: "confirm"; key: string } | { kind: "field"; field: string };
}

/** Tariff lookups per item index (undefined = not looked up yet). */
export type TariffByItem = Record<number, TariffResult | "loading" | "error" | undefined>;

export interface CoverageRow {
  area: string;
  status: "Checked (blocks/warns)" | "Advisory" | "Not covered";
  how: string;
  source?: { label: string; url: string };
}

export const STAGES: { id: Stage; label: string }[] = [
  { id: "booking", label: "Before booking" },
  { id: "collection", label: "Before collection" },
  { id: "border", label: "At the border" },
  { id: "after", label: "After delivery" },
];

// --- Sources (each URL checked to resolve; EUR-Lex ELI links sit behind a browser challenge) ---------
export const SOURCES = {
  ics2: { label: "European Commission: ICS2", url: "https://taxation-customs.ec.europa.eu/customs-4/customs-security/import-control-system-2-ics2-0_en" },
  access2markets: { label: "Access2Markets", url: "https://trade.ec.europa.eu/access-to-markets/en/home" },
  ukEori: { label: "GOV.UK: Get an EORI number", url: "https://www.gov.uk/eori" },
  euEori: { label: "European Commission: EORI", url: "https://taxation-customs.ec.europa.eu/customs-4/customs-procedures-import-and-export-0/customs-procedures/economic-operators-registration-and-identification-number-eori_en" },
  exportDecl: { label: "GOV.UK: Make an export declaration", url: "https://www.gov.uk/guidance/make-and-manage-an-export-declaration-online" },
  gvms: { label: "GOV.UK: Create a goods movement reference", url: "https://www.gov.uk/guidance/create-a-goods-movement-reference" },
  vatExport: { label: "GOV.UK: VAT Notice 703", url: "https://www.gov.uk/guidance/vat-on-goods-exported-from-the-uk-notice-703" },
  exportGoods: { label: "GOV.UK: Export goods step by step", url: "https://www.gov.uk/export-goods" },
  antiDumping: { label: "GOV.UK: Anti-dumping and countervailing duties", url: "https://www.gov.uk/guidance/check-when-you-need-to-pay-anti-dumping-countervailing-and-safeguard-duties" },
  tariff: { label: "GOV.UK: Trade Tariff", url: "https://www.gov.uk/trade-tariff" },
  euVat: { label: "European Commission: VAT rates", url: "https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en" },
  rulesOfOrigin: { label: "European Commission: Rules of origin", url: "https://taxation-customs.ec.europa.eu/customs-4/calculation-customs-duties/rules-origin_en" },
  foodContact: { label: "EUR-Lex: Regulation (EC) No 1935/2004", url: "https://eur-lex.europa.eu/eli/reg/2004/1935/oj" },
  textile: { label: "EUR-Lex: Regulation (EU) No 1007/2011", url: "https://eur-lex.europa.eu/eli/reg/2011/1007/oj" },
  toys: { label: "EUR-Lex: Directive 2009/48/EC", url: "https://eur-lex.europa.eu/eli/dir/2009/48/oj" },
  batteries: { label: "EUR-Lex: Regulation (EU) 2023/1542", url: "https://eur-lex.europa.eu/eli/reg/2023/1542/oj" },
  lvd: { label: "EUR-Lex: Directive 2014/35/EU (LVD)", url: "https://eur-lex.europa.eu/eli/dir/2014/35/oj" },
  emc: { label: "EUR-Lex: Directive 2014/30/EU (EMC)", url: "https://eur-lex.europa.eu/eli/dir/2014/30/oj" },
  weee: { label: "EUR-Lex: Directive 2012/19/EU (WEEE)", url: "https://eur-lex.europa.eu/eli/dir/2012/19/oj" },
  cosmetics: { label: "EUR-Lex: Regulation (EC) No 1223/2009", url: "https://eur-lex.europa.eu/eli/reg/2009/1223/oj" },
  gpsr: { label: "EUR-Lex: Regulation (EU) 2023/988 (GPSR)", url: "https://eur-lex.europa.eu/eli/reg/2023/988/oj" },
} as const;

const GUIDANCE = "General guidance — check Access2Markets for your exact product.";

// --- Helpers ---------------------------------------------------------------------------------------
const itemLabel = (it: Item, i: number) => it.description?.trim() || it.sku || `Item ${i + 1}`;
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const pct = (n: number) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

/** "5.50 %" → 5.5. Anything that isn't a plain percentage (e.g. "8.00 % + 9.40 EUR / 100 kg") → null. */
export function parsePct(rate: string): number | null {
  const m = rate.trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
  return m ? Number(m[1]) : null;
}

/** 8-digit form for chapter matching only: list codes for chapters 01–09 have 7 digits (no leading zero). */
export const hs8 = (code: string) => (code.length === 7 ? "0" + code : code);

/** Who pays EU import duty and VAT under the Incoterm in force. */
export function payer(b: Booking): { owner: Owner; text: string; term: "DAP" | "DDP"; assumed: boolean } {
  const inc = effectiveIncoterm(b);
  return inc.term === "DDP"
    ? { owner: "You", text: "you (DDP)", term: "DDP", assumed: inc.assumed }
    : { owner: "Receiver", text: "your receiver (DAP)", term: "DAP", assumed: inc.assumed };
}

/** Booking field an issue points at (same paths the booking sheet uses). */
function fieldFor(i: Issue): string | undefined {
  const it = (f: string) => (i.itemIndex != null ? `items[${i.itemIndex}].${f}` : undefined);
  switch (i.rule) {
    case "R-01": return it("hsCode");
    case "R-02": return "declaredValue";
    case "R-03": return it("quantity");
    case "R-04": return "cartons";
    case "R-05": return "pallets";
    case "R-06": return it("description");
    case "R-07": return "grossWeight";
    case "R-08": return "appointment";
    case "R-09": return it("countryOfOrigin");
    case "R-10": return "readyDate";
    case "D-01": return it("description");
    default: return undefined;
  }
}

// --- Chapter rules (advisory) --------------------------------------------------------------------
interface ChapterRule {
  id: string;
  match: (code8: string) => boolean;
  title: string;
  why: string;
  source: { label: string; url: string };
}
const starts = (...ps: string[]) => (c: string) => ps.some((p) => c.startsWith(p));
export const CHAPTER_RULES: ChapterRule[] = [
  { id: "food-contact", match: starts("6912", "3924", "7323"), title: "Food-contact materials", why: "Tableware and kitchenware must be safe in contact with food and carry the food-contact symbol or wording (Regulation (EC) No 1935/2004).", source: SOURCES.foodContact },
  { id: "textile", match: starts("61", "62", "63"), title: "Textile fibre labelling", why: "Clothing and textiles sold in the EU need a label with the fibre composition in the local language (Regulation (EU) No 1007/2011).", source: SOURCES.textile },
  { id: "toys", match: starts("9503"), title: "Toy safety and CE marking", why: "Toys need CE marking, an EU declaration of conformity, warnings in the local language and an EU address (Directive 2009/48/EC).", source: SOURCES.toys },
  { id: "batteries", match: starts("8506", "8507"), title: "EU Battery Regulation", why: "Batteries need labelling, a CE mark and producer registration for take-back in each country you sell in (Regulation (EU) 2023/1542).", source: SOURCES.batteries },
  { id: "electrical", match: (c) => (c.startsWith("84") || c.startsWith("85")) && !starts("8506", "8507")(c), title: "CE marking for electrical goods + WEEE", why: "Electrical products need CE marking under the Low Voltage (2014/35/EU) and EMC (2014/30/EU) Directives, and WEEE producer registration in each country you sell in (Directive 2012/19/EU).", source: SOURCES.lvd },
  { id: "cosmetics", match: starts("33"), title: "Cosmetics Regulation", why: "Cosmetics need an EU responsible person, a safety report and notification on the EU portal (CPNP) before sale (Regulation (EC) No 1223/2009).", source: SOURCES.cosmetics },
];

// --- Builders ------------------------------------------------------------------------------------
function bookingStage(a: Analysis): ChecklistItem[] {
  const open = a.issues.filter((i) => i.severity !== "info");
  if (!open.length)
    return [{ id: "booking:all-passed", stage: "booking", type: "task", owner: "You", title: `All ${RULES.length} checks passed`, why: "Value, cartons, weights, HS codes, origin, dates and restricted goods all check out for this booking.", done: true }];
  return open.map((i, k) => {
    const field = fieldFor(i);
    const ics2 = i.rule === "R-01" || i.rule === "D-01";
    return {
      id: `booking:${i.rule}:${i.itemIndex ?? "all"}:${k}`,
      stage: "booking",
      type: i.severity === "red" ? "blocker" : "warning",
      owner: "You",
      title: i.title,
      why: i.detail,
      consequence: `${ruleName(i.rule)}: ${i.fix}`,
      source: ics2 ? SOURCES.ics2 : undefined,
      done: false,
      action: field ? { kind: "field", field } : undefined,
    } satisfies ChecklistItem;
  });
}

function partiesStage(b: Booking): ChecklistItem[] {
  const [exporter, consignee, euId] = neededFromYou(b);
  const pay = payer(b);
  const out: ChecklistItem[] = [
    { id: "collection:uk-eori", stage: "collection", type: "task", owner: "You", title: "Your UK EORI number", why: exporter.error ?? exporter.note, consequence: "Without it the UK export declaration can't be lodged and the truck is held at the border.", source: SOURCES.ukEori, done: exporter.done, action: { kind: "field", field: "exporterEori" } },
    { id: "collection:receiver", stage: "collection", type: "task", owner: "You", title: "Receiver's name and address", why: consignee.note, consequence: "The commercial invoice and the EU pre-arrival filing need the consignee.", done: consignee.done, action: { kind: "field", field: "consigneeName" } },
  ];
  if (pay.term === "DDP")
    out.push({ id: "collection:eu-eori-ddp", stage: "collection", type: "task", owner: "You", title: "Your EU EORI and EU VAT arrangement (DDP)", why: `${euId.error ? euId.error + " " : euId.done ? `EU EORI ${euId.note}. ` : ""}Under DDP you are the importer into ${b.destCountry || "the EU"}: you need an EU EORI and a way to account for import VAT there (a local VAT registration, or a customs broker / fiscal representative acting for you).`, consequence: "Without an EU EORI the goods can't be released from EU customs.", source: SOURCES.euEori, done: euId.done, action: { kind: "field", field: "sellerEuEori" } });
  else
    out.push({ id: "collection:eu-eori-dap", stage: "collection", type: "task", owner: "Receiver", title: "Receiver's EU EORI / VAT number", why: euId.error ?? euId.note, consequence: "The receiver (or their broker) can't clear import and pay duty/VAT without it.", source: SOURCES.euEori, done: euId.done, action: { kind: "field", field: "consigneeEori" } });
  return out;
}

function tariffItems(b: Booking, i: number, t: TariffResult): ChecklistItem[] {
  const it = b.items[i];
  const name = itemLabel(it, i);
  const pay = payer(b);
  const out: ChecklistItem[] = [];
  // Per-commodity tariff pages block automated link checks, so link the verified GOV.UK entry point and name the code.
  const src = (side: "eu" | "uk") => ({ label: `UK Trade Tariff: look up ${t.code} (${side === "eu" ? "Northern Ireland / EU import" : "UK export"})`, url: SOURCES.tariff.url });
  const sides: { side: "eu" | "uk"; c: TariffControl }[] = [
    ...t.euImport.controls.map((c) => ({ side: "eu" as const, c })),
    ...t.ukExport.controls.map((c) => ({ side: "uk" as const, c })),
  ];
  const subNote = (all: boolean) => (all ? "" : " Applies to some 10-digit sub-codes only; check the exact code.");

  for (const { side, c } of sides) {
    const key = `${i}:${c.type}`;
    const docs = c.documents.map((d) => d.code).join(" / ");
    const where = side === "eu" ? `EU import (${t.origin} origin)` : `UK export to ${t.dest}`;
    const owner: Owner = side === "eu" ? pay.owner : "You";
    if (RESTRICTION_RE.test(c.type) || !c.waivers.length) {
      out.push({
        id: `collection:control:${key}`, stage: "collection", type: "warning", owner,
        title: RESTRICTION_RE.test(c.type) ? `${name}: ${c.type}` : `${name}: licence/certificate ${docs} needed before collection`,
        why: `The UK Trade Tariff lists "${c.type}" for ${t.code} on ${where}. Customs expects one of: ${c.documents.map((d) => `${d.code} (${short(d.description, 70)})`).join("; ")}.${c.waivers.length ? ` Not needed if ${c.waivers.map((w) => w.code).join(", ")}: ${short(c.waivers[0].description, 90)}.` : ""}${subNote(c.allSubcodes)}`,
        consequence: "Without it the goods are held at the border.",
        source: src(side), done: false,
      });
    } else {
      const waiver = c.waivers.map((w) => w.code).join(", ");
      out.push({
        id: `collection:control:${key}`, stage: "collection", type: "task", owner: "You",
        title: `${name}: provide ${docs} or confirm exemption (${waiver}: ${short(c.waivers[0].description, 80)})`,
        why: `"${c.type}" on ${where} for ${t.code}. Most products are exempt; if so, the declaration quotes ${waiver}. Otherwise one of these documents is needed: ${c.documents.map((d) => `${d.code} (${short(d.description, 60)})`).join("; ")}.${subNote(c.allSubcodes)}`,
        consequence: "The declarant needs either the document or the exemption code.",
        source: src(side), done: !!b.confirmations?.[key],
        action: { kind: "confirm", key },
      });
    }
  }

  // Prohibitions / restrictions with no document at all.
  const restr = [
    ...(t.euImport.restrictions ?? []).map((r) => ({ side: "eu" as const, r })),
    ...(t.ukExport.restrictions ?? []).map((r) => ({ side: "uk" as const, r })),
  ].filter(({ r }) => !sides.some((s) => s.c.type === r.type));
  for (const { side, r } of restr)
    out.push({
      id: `collection:restriction:${i}:${r.type}`, stage: "collection", type: "warning", owner: side === "eu" ? pay.owner : "You",
      title: `${name}: ${r.type}`,
      why: `The UK Trade Tariff lists "${r.type}" for ${t.code} (${side === "eu" ? `EU import, ${t.origin} origin` : `UK export to ${t.dest}`}).${subNote(r.allSubcodes)} Check with your customs broker before booking.`,
      consequence: "Goods may be refused at the border.",
      source: src(side), done: false,
    });

  // Anti-dumping / countervailing duty for this origin.
  for (const d of t.euImport.duties) {
    if (!/anti-dumping|countervailing/i.test(d.label)) continue;
    const p = parsePct(d.rate);
    if (p === 0) continue;
    const kind = /countervailing/i.test(d.label) ? "Countervailing" : "Anti-dumping";
    out.push({
      id: `collection:ad:${i}:${d.label}`, stage: "collection", type: "warning", owner: pay.owner,
      title: `${name}: ${kind.toLowerCase()} duty ${p != null ? pct(p) : d.rate} (made in ${t.origin})`,
      why: `The EU charges ${kind.toLowerCase()} duty of ${p != null ? pct(p) : d.rate + " (see tariff)"} on ${t.code} made in ${t.origin}, on top of normal duty. Paid by ${pay.text}${pay.assumed ? ", assumed from the site type" : ""} at EU import.${subNote(d.allSubcodes)}`,
      consequence: pay.term === "DAP" ? "Your receiver may refuse the goods or bill you back if they didn't expect it." : "You pay it before the goods are released.",
      source: SOURCES.antiDumping, done: false,
    });
  }
  return out;
}

function chapterAdvisories(b: Booking): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const r of CHAPTER_RULES) {
    const hits = b.items.map((it, i) => ({ it, i })).filter(({ it }) => it.hsCode && r.match(hs8(it.hsCode)));
    if (!hits.length) continue;
    out.push({
      id: `collection:advisory:${r.id}`, stage: "collection", type: "advisory", owner: "You",
      title: `${r.title}: ${hits.map(({ it, i }) => itemLabel(it, i)).join(", ")}`,
      why: `${r.why} ${GUIDANCE}`,
      source: r.source,
    });
  }
  if (b.destType === "Warehouse")
    out.push({
      id: "collection:advisory:gpsr", stage: "collection", type: "advisory", owner: "You",
      title: "General Product Safety Regulation: EU responsible person",
      why: `Consumer goods sold in the EU need an EU-based responsible person named on the product or its packaging and on the online listing (Regulation (EU) 2023/988). ${GUIDANCE}`,
      source: SOURCES.gpsr,
    });
  return out;
}

function borderStage(b: Booking): ChecklistItem[] {
  const route = "Dover–Calais";
  return [
    { id: "border:export-declaration", stage: "border", type: "task", owner: "Carrier", title: "UK export declaration before departure (CDS)", why: "The carrier or its customs agent lodges it on HMRC's Customs Declaration Service from your commercial invoice and your UK EORI.", consequence: "No declaration, no departure from the UK.", source: SOURCES.exportDecl, done: false },
    { id: "border:gvms", stage: "border", type: "task", owner: "Carrier", title: `GVMS goods movement reference (${route})`, why: "The haulier links the export and import declarations to one goods movement reference (GMR) before check-in at the port.", consequence: "Trucks without a GMR are turned away at check-in.", source: SOURCES.gvms, done: false },
    { id: "border:ics2", stage: "border", type: "task", owner: "Carrier", title: "EU pre-arrival safety & security filing (ICS2)", why: `Filed before the truck reaches ${b.destCountry || "the EU"}, using your HS code (at least 6 digits), a precise goods description and the consignee's EORI.`, consequence: "Short codes or vague descriptions trigger a request for information and hold the truck.", source: SOURCES.ics2, done: false },
  ];
}

function afterStage(): ChecklistItem[] {
  return [
    { id: "after:proof-of-export", stage: "after", type: "task", owner: "You", title: "Keep proof of export for zero-rated UK VAT", why: "Keep the export declaration (MRN), the carrier's transport documents and the invoice, so you can zero-rate the sale for UK VAT.", consequence: "Without proof HMRC can charge UK VAT on the sale.", source: SOURCES.vatExport },
    { id: "after:pod", stage: "after", type: "task", owner: "You", title: "Proof of delivery and count against the packing list", why: "Get the signed proof of delivery and check the receiver's carton count against the packing list.", consequence: "Shortages reported late are hard to claim from the carrier." },
  ];
}

export function buildChecklist(a: Analysis, tariff: TariffByItem): ChecklistItem[] {
  const b = a.booking;
  const perItem = b.items.flatMap((_, i) => {
    const t = tariff[i];
    return t && typeof t === "object" ? tariffItems(b, i, t) : [];
  });
  return [...bookingStage(a), ...partiesStage(b), ...perItem, ...chapterAdvisories(b), ...borderStage(b), ...afterStage()];
}

// --- Landed cost (estimate) ----------------------------------------------------------------------
export const IMPORT_VAT: Record<string, number> = { Germany: 19, France: 20, Netherlands: 21 };

export interface LandedLine {
  index: number;
  name: string;
  goods: number;
  freight: number;
  customsValue: number;
  /** Percent rates that make up the duty (preferential/standard + anti-dumping/countervailing). */
  parts: { label: string; rate: number }[];
  dutyRate: number;
  duty: number;
  vat: number;
  /** Duty components that aren't plain percentages ("see tariff"). */
  seeTariff: string[];
}
export interface LandedCost {
  lines: LandedLine[];
  /** Items left out (no tariff data yet, or no quantity/price). */
  skipped: { index: number; name: string; reason: string }[];
  vatRate: number | null;
  totals: { goods: number; freight: number; customsValue: number; duty: number; vat: number; total: number };
  payer: ReturnType<typeof payer>;
}

export function landedCost(a: Analysis, tariff: TariffByItem): LandedCost {
  const b = a.booking;
  const values = b.items.map((it) => (it.quantity ?? 0) * (it.unitPrice ?? 0));
  const allGoods = values.reduce((s, v) => s + v, 0);
  const freight = a.recommendation.chosen?.freight ?? 0;
  const vatRate = IMPORT_VAT[b.destCountry] ?? null;
  const lines: LandedLine[] = [], skipped: LandedCost["skipped"] = [];
  b.items.forEach((it, i) => {
    const name = itemLabel(it, i);
    const t = tariff[i];
    if (!values[i]) return void skipped.push({ index: i, name, reason: "no quantity or unit price" });
    if (!t || typeof t !== "object") return void skipped.push({ index: i, name, reason: t === "loading" ? "tariff still loading" : t === "error" ? "tariff unavailable" : "needs a full HS code and country of origin" });
    const parts: LandedLine["parts"] = [], seeTariff: string[] = [];
    const add = (label: string, rate: string) => {
      const p = parsePct(rate);
      if (p == null) seeTariff.push(`${label}: ${rate}`);
      else parts.push({ label, rate: p });
    };
    const pref = it.countryOfOrigin === "United Kingdom" ? t.euImport.duties.find((d) => /^Preferential duty/.test(d.label)) : undefined;
    const std = t.euImport.duties.find((d) => /^Standard/.test(d.label));
    if (pref) add("UK preferential duty", pref.rate);
    else if (std) add("Standard duty", std.rate);
    for (const d of t.euImport.duties) if (/anti-dumping|countervailing/i.test(d.label)) add(d.label, d.rate);
    const share = allGoods ? (values[i] / allGoods) * freight : 0;
    const customsValue = values[i] + share;
    const dutyRate = parts.reduce((s, p) => s + p.rate, 0);
    const duty = (customsValue * dutyRate) / 100;
    const vat = vatRate != null ? ((customsValue + duty) * vatRate) / 100 : 0;
    lines.push({ index: i, name, goods: values[i], freight: share, customsValue, parts, dutyRate, duty, vat, seeTariff });
  });
  const sum = (f: (l: LandedLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const totals = { goods: sum((l) => l.goods), freight: sum((l) => l.freight), customsValue: sum((l) => l.customsValue), duty: sum((l) => l.duty), vat: sum((l) => l.vat), total: 0 };
  totals.total = totals.duty + totals.vat;
  return { lines, skipped, vatRate, totals, payer: payer(b) };
}

// --- Coverage matrix (Method page) ---------------------------------------------------------------
export const COVERAGE_MATRIX: CoverageRow[] = [
  ...RULES.map((r): CoverageRow => ({
    area: r.name,
    status: "Checked (blocks/warns)",
    how: `${r.rule}. ${r.advisory ? "Warns, never blocks." : r.severity === "red" ? "Blocks the booking until fixed." : "Warns; needs a look before booking."}`,
    source: r.id === "R-01" || r.id === "D-01" ? SOURCES.ics2 : undefined,
  })),
  { area: "EU pre-arrival data quality (ICS2)", status: "Checked (blocks/warns)", how: "HS code of at least 6 digits (HS code check) and a specific description (Customs description check), the data ICS2 needs.", source: SOURCES.ics2 },
  { area: "Documents and EORI numbers", status: "Advisory", how: "Tasks before collection: your UK EORI, receiver details, and the EU EORI of whoever imports (receiver under DAP, you under DDP). Format checks only.", source: SOURCES.ukEori },
  { area: "Official tariff controls and prohibitions", status: "Advisory", how: "Live from the UK Trade Tariff per HS code and origin: controls with an exemption become tasks you confirm; licences with no exemption and prohibitions become warnings.", source: SOURCES.tariff },
  { area: "Duty, anti-dumping and landed cost", status: "Advisory", how: "Standard or UK-preferential duty plus anti-dumping/countervailing duty from the tariff; import VAT at DE 19%, FR 20%, NL 21%; who pays from the Incoterm. An estimate.", source: SOURCES.antiDumping },
  { area: "Product rules by chapter + GPSR", status: "Advisory", how: "Food contact, textile labelling, toys, batteries, CE/WEEE for electrical goods, cosmetics, and the EU responsible person for consumer goods. General guidance only.", source: SOURCES.access2markets },
  { area: "Import VAT registration specifics per country", status: "Not covered", how: "Whether you need a local VAT number, fiscal representative or postponed accounting. Ask your broker." },
  { area: "National product rules", status: "Not covered", how: "Rules set by Germany, France or the Netherlands on top of EU law (e.g. packaging, language)." },
  { area: "Product conformity testing and certification", status: "Not covered", how: "We flag that CE or similar rules may apply; we don't check test reports or declarations." },
  { area: "Packaging EPR registration", status: "Not covered", how: "Extended producer responsibility registrations for packaging in each country (e.g. LUCID in Germany)." },
  { area: "Sanctions and denied-party screening", status: "Not covered", how: "Receivers and end users aren't screened against sanctions lists." },
  { area: "Plant health outside the tariff", status: "Not covered", how: "Phytosanitary rules (e.g. wooden pallets ISPM 15) beyond what the tariff lists as controls." },
  { area: "Other dangerous-goods classes", status: "Not covered", how: "Only lithium batteries, aerosols and flammable liquids/gases are detected; other ADR classes (corrosives, toxics, oxidisers…) aren't." },
];
