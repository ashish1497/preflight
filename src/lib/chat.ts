// Chat booking: merge what the AI extracted into the draft, derive what can be
// derived, and decide (deterministically) what to ask next.
import { DEST_CITIES, INCOTERMS, MODEL, ORIGIN_CITIES, ORIGIN_COUNTRIES_OF_GOODS, effectiveIncoterm } from "./reference";
import { describeHs, matchSuggestion, normalizeHs, type HsLookup } from "./hs";
import { addBusinessDays, formatDateLong, parseDate } from "./dates";
import { sumItems } from "./rules";
import type { Booking, DestType, Item, Patch, Priority } from "./types";

export interface Extraction {
  reply: string;
  booking: {
    sellerName: string | null;
    originCity: string | null;
    destCity: string | null;
    destType: DestType | null;
    readyDate: string | null;
    neededBy: string | null;
    priority: Priority | null;
    pallets: number | null;
    cartons: number | null;
    declaredValue: number | null;
    grossWeight: number | null;
    appointment: boolean | null;
    incoterm: "DAP" | "DDP" | null;
    exporterEori: string | null;
    consigneeName: string | null;
    consigneeAddress: string | null;
  };
  items: {
    action: "add" | "update" | "remove";
    match: string | null;
    sku: string | null;
    description: string | null;
    hsCode: string | null;
    hsIsSuggestion: boolean;
    quantity: number | null;
    unitPrice: number | null;
    unitsPerCarton: number | null;
    cartons: number | null;
    unitWeight: number | null;
    countryOfOrigin: string | null;
  }[];
}

/** Totals we calculated for the seller (recalculated while the seller hasn't overridden them). */
export type Derived = { cartons: boolean; declaredValue: boolean };

export function emptyDraft(): Booking {
  return {
    id: "NEW",
    sellerName: "",
    originCity: "",
    originCountry: "United Kingdom",
    destCity: "",
    destCountry: "",
    destType: null,
    readyDate: null,
    priority: null,
    pallets: null,
    cartons: null,
    declaredValue: null,
    currency: "GBP",
    grossWeight: null,
    appointment: null,
    items: [],
    neededBy: null,
  };
}

const commonPrefix = (xs: string[]) => xs.reduce((p, x) => { let i = 0; while (i < p.length && p[i] === x[i]) i++; return p.slice(0, i); });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function findItem(items: Item[], match: string | null): number {
  if (!match) return items.length === 1 ? 0 : -1;
  const m = norm(match);
  let i = items.findIndex((it) => norm(it.sku) === m);
  if (i < 0) i = items.findIndex((it) => norm(it.description).includes(m) || m.includes(norm(it.description)));
  if (i < 0) i = items.findIndex((it) => m.split(/\s+/).some((w) => w.length > 3 && norm(it.description).includes(w)));
  return i;
}

function skuFor(desc: string, n: number) {
  const base = desc.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.slice(0, 4)).join("-");
  return `${base || "ITEM"}-${String(n).padStart(2, "0")}`;
}

/** Fill whichever of quantity / units per carton / cartons can be worked out from the other two. */
function deriveItem(it: Item): Item {
  const out = { ...it };
  if (out.quantity != null && out.unitsPerCarton && out.cartons == null) {
    const c = out.quantity / out.unitsPerCarton;
    if (Number.isInteger(c)) out.cartons = c;
  } else if (out.quantity == null && out.unitsPerCarton != null && out.cartons != null) {
    out.quantity = out.unitsPerCarton * out.cartons;
  } else if (out.quantity != null && out.cartons && out.unitsPerCarton == null) {
    const u = out.quantity / out.cartons;
    if (Number.isInteger(u)) out.unitsPerCarton = u;
  }
  return out;
}

export function mergeExtraction(draft: Booking, derived: Derived, x: Extraction, hs: HsLookup | null): { booking: Booking; derived: Derived } {
  const b: Booking = { ...draft, items: draft.items.map((i) => ({ ...i })) };
  const d = { ...derived };
  const xb = x.booking;

  if (xb.sellerName) b.sellerName = xb.sellerName;
  if (xb.originCity) b.originCity = xb.originCity;
  if (xb.destCity) {
    b.destCity = xb.destCity;
    b.destCountry = DEST_CITIES[xb.destCity] ?? b.destCountry;
  }
  if (xb.destType) b.destType = xb.destType;
  if (xb.readyDate) b.readyDate = parseDate(xb.readyDate) ?? b.readyDate;
  if (xb.neededBy) b.neededBy = parseDate(xb.neededBy) ?? b.neededBy;
  if (xb.priority) b.priority = xb.priority;
  if (xb.pallets != null) b.pallets = xb.pallets;
  if (xb.grossWeight != null) b.grossWeight = xb.grossWeight;
  if (xb.appointment != null) b.appointment = xb.appointment;
  if (xb.incoterm) b.incoterm = xb.incoterm;
  if (xb.exporterEori) b.exporterEori = xb.exporterEori;
  if (xb.consigneeName) b.consigneeName = xb.consigneeName;
  if (xb.consigneeAddress) b.consigneeAddress = xb.consigneeAddress;
  // A total the seller states overrides our calculation from then on.
  if (xb.cartons != null) { b.cartons = xb.cartons; d.cartons = false; }
  if (xb.declaredValue != null) { b.declaredValue = xb.declaredValue; d.declaredValue = false; }

  for (const op of x.items) {
    const idx = op.action === "add" ? -1 : findItem(b.items, op.match ?? op.sku ?? op.description);
    if (op.action === "remove") {
      if (idx >= 0) b.items.splice(idx, 1);
      continue;
    }
    const target: Item =
      idx >= 0
        ? b.items[idx]
        : { sku: "", description: "", hsCode: null, quantity: null, unitPrice: null, unitsPerCarton: null, cartons: null, unitWeight: null, countryOfOrigin: null };
    if (op.description) target.description = op.description;
    if (op.sku) target.sku = op.sku;
    let code = normalizeHs(op.hsCode);
    // A suggested code is only kept if it exists in the tariff list. One match → use that exact
    // listed code; several → keep the digits and ask the seller to pick a listed code.
    if (code && op.hsIsSuggestion) {
      const ms = matchSuggestion(code, hs);
      code = ms.length === 1 ? ms[0].code : ms.length ? commonPrefix(ms.map((m) => m.code)) : null;
    }
    if (code) {
      target.hsCode = code;
      target.hsSuggested = op.hsIsSuggestion;
    }
    for (const k of ["quantity", "unitPrice", "unitsPerCarton", "cartons", "unitWeight"] as const)
      if (op[k] != null) target[k] = op[k];
    if (op.countryOfOrigin) target.countryOfOrigin = op.countryOfOrigin;
    if (idx < 0 && (target.description || target.sku)) {
      if (!target.sku) target.sku = skuFor(target.description, b.items.length + 1);
      b.items.push(target);
    }
  }

  b.items = b.items.map(deriveItem);
  const s = sumItems(b);
  const itemsComplete = b.items.length > 0 && b.items.every((it) => it.cartons != null && it.quantity != null && it.unitPrice != null);
  if (itemsComplete && (d.cartons || b.cartons == null)) { b.cartons = s.cartons; d.cartons = true; }
  if (itemsComplete && (d.declaredValue || b.declaredValue == null)) { b.declaredValue = Math.round(s.value * 100) / 100; d.declaredValue = true; }
  return { booking: b, derived: d };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** One answer choice. Picking it applies `patches` directly (no AI round trip). */
export interface QOption {
  label: string;
  description?: string;
  recommended?: boolean;
  patches: Patch[];
}

/** A question asked back to the seller, shown as a numbered card with choices. */
export interface Question {
  id: string;
  /** Short chip, e.g. "Pallets". */
  header: string;
  text: string;
  /** Why we're asking / how we got the recommendation. */
  hint?: string;
  options: QOption[];
  /** Free-text answer allowed (sent to the AI to interpret). */
  other?: { placeholder: string; examples: string[] };
}

const bk = (field: keyof Booking, value: unknown): Patch => ({ kind: "booking", field, value });
const itp = (index: number, field: keyof Item, value: unknown): Patch => ({ kind: "item", index, field, value });

/** What's still missing for a complete booking, as questions with choices - at most 3 at a time. */
export function nextQuestions(b: Booking, hs: HsLookup | null, today: string): { questions: Question[]; complete: boolean } {
  const q: Question[] = [];

  if (!b.originCity)
    q.push({
      id: "origin", header: "Collect from", text: "Which city do we collect the goods from?",
      options: ORIGIN_CITIES.map((c) => ({ label: c, patches: [bk("originCity", c)] })),
    });
  if (!b.destCity)
    q.push({
      id: "dest", header: "Deliver to", text: "Which city is it going to?",
      options: Object.entries(DEST_CITIES).map(([c, country]) => ({ label: c, description: country, patches: [bk("destCity", c), bk("destCountry", country)] })),
    });
  if (!b.destType)
    q.push({
      id: "destType", header: "Site type", text: "What kind of site receives the goods?",
      hint: "Warehouses need a booked delivery slot; shops and offices usually don't.",
      options: [
        { label: "Warehouse", description: "Fulfilment or distribution centre, e.g. an Amazon FC", patches: [bk("destType", "Warehouse")] },
        { label: "Business address", description: "Shop, office or other business", patches: [bk("destType", "Business address")] },
      ],
    });

  if (!b.items.length)
    q.push({
      id: "items", header: "Products", text: "What are you shipping?",
      hint: "For each product: what it is, how many units, price per unit, units per carton, weight per unit, and where it was made.",
      options: [],
      other: {
        placeholder: "Describe your products…",
        examples: [
          "1080 ceramic mugs, £5 each, 12 per carton, 0.5 kg each, made in the UK",
          "800 cotton T-shirts at £6, 20 per box, 0.2 kg each, made in India",
          "400 wool blankets, £22 each, 10 per carton, 1.2 kg, made in Turkey",
        ],
      },
    });

  b.items.forEach((it, i) => {
    if (q.length >= 3) return;
    const name = it.description || it.sku;
    const need: string[] = [];
    if (it.quantity == null) need.push("units");
    if (it.unitPrice == null) need.push("price per unit");
    if (it.unitsPerCarton == null && it.cartons == null) need.push("units per carton");
    else if (it.cartons == null) need.push("number of cartons");
    if (it.unitWeight == null) need.push("weight per unit");
    if (need.length)
      q.push({
        id: `item-${i}`, header: "Product details", text: `For "${name}", what's the ${list(need)}?`,
        options: [],
        other: {
          placeholder: `e.g. ${need.map((n) => ({ units: "500 units", "price per unit": "£4.50 each", "units per carton": "12 per carton", "number of cartons": "40 cartons", "weight per unit": "0.4 kg each" })[n as "units"]).join(", ")}`,
          examples: [need.map((n) => ({ units: "1000 units", "price per unit": "£5 each", "units per carton": "20 per carton", "number of cartons": "50 cartons", "weight per unit": "0.5 kg each" })[n as "units"]).join(", ")],
        },
      });
    if (!it.countryOfOrigin && q.length < 3)
      q.push({
        id: `coo-${i}`, header: "Made in", text: `Where was "${name}" made?`,
        hint: "Where it was manufactured, not where it ships from. UK-made goods can enter the EU duty-free.",
        options: ORIGIN_COUNTRIES_OF_GOODS.map((c) => ({ label: c, patches: [itp(i, "countryOfOrigin", c)] })),
      });
    if (q.length >= 3) return;
    if (!it.hsCode)
      q.push({
        id: `hs-${i}`, header: "HS code", text: `What's the HS (customs) code for "${name}"?`,
        hint: "Customs uses it to classify the product. At least 6 digits; we check it against the 2026 tariff list.",
        options: [],
        other: { placeholder: "e.g. 691200, or “not sure, suggest one”", examples: ["Not sure, please suggest one"] },
      });
    else if (it.hsSuggested) {
      const info = describeHs(it.hsCode, hs);
      q.push(
        info.exact
          ? {
              id: `hs-${i}`, header: "HS code", text: `Is ${it.hsCode} the right commodity code for "${name}"?`,
              hint: `${info.description} (2026 tariff list)`,
              options: [{ label: `Yes, use ${it.hsCode}`, description: "Suggested from your description", recommended: true, patches: [itp(i, "hsCode", it.hsCode)] }],
              other: { placeholder: "Or type the correct code", examples: [] },
            }
          : {
              id: `hs-${i}`, header: "HS code", text: `Which commodity code fits "${name}"?`,
              hint: `${info.matches.length} codes in the 2026 tariff list match. Pick the one that describes the product.`,
              options: info.matches.slice(0, 12).map((m) => ({ label: m.code, description: m.description, patches: [itp(i, "hsCode", m.code)] })),
              other: { placeholder: "Or type the correct code", examples: [] },
            },
      );
    }
  });

  const s = sumItems(b);
  if (q.length < 3 && b.grossWeight == null) {
    const est = s.net ? Math.ceil(s.net + (b.cartons ?? s.cartons) * MODEL.kgPerCarton + (b.pallets ?? 1) * MODEL.kgPerPallet) : 0;
    q.push({
      id: "gross", header: "Gross weight", text: "What's the total gross weight, including cartons and pallets?",
      hint: est ? `Goods alone weigh about ${Math.round(s.net)} kg (unit weight × quantity). Estimate adds ~${MODEL.kgPerCarton} kg per carton and ~${MODEL.kgPerPallet} kg per pallet.` : undefined,
      options: est ? [{ label: `About ${est} kg`, description: "Our estimate. Use the weighed figure if you have it", recommended: true, patches: [bk("grossWeight", est)] }] : [],
      other: { placeholder: "e.g. 620 kg", examples: est ? [`${Math.round(est * 1.05)} kg`] : ["620 kg"] },
    });
  }
  if (q.length < 3 && b.pallets == null) {
    // Use the stated gross weight, or our estimate from the goods if it isn't known yet.
    const estimated = s.net ? Math.ceil(s.net + (b.cartons ?? s.cartons) * MODEL.kgPerCarton) : 0;
    const w = b.grossWeight ?? (estimated || null);
    const fit = w ? Math.max(1, Math.ceil(w / 500)) : null; // fits economy and standard services
    const opts = [...new Set([fit ?? 1, (fit ?? 1) + 1, (fit ?? 1) + 2].filter((n) => n >= 1))];
    q.push({
      id: "pallets", header: "Pallets", text: "How many pallets?",
      hint: fit ? `At ${b.grossWeight == null ? "about " : ""}${w} kg, ${fit} pallet${fit > 1 ? "s" : ""} keeps each under 500 kg, so economy and standard services can take it.` : undefined,
      options: opts.map((n) => ({ label: `${n} pallet${n > 1 ? "s" : ""}`, recommended: n === fit, patches: [bk("pallets", n)] })),
      other: { placeholder: "Another number", examples: [] },
    });
  }
  if (q.length < 3 && !b.readyDate) {
    const d1 = addBusinessDays(today, 1), d2 = addBusinessDays(today, 2), d3 = addBusinessDays(today, 5);
    q.push({
      id: "ready", header: "Ready date", text: "When will the goods be packed and ready for collection?",
      options: [
        { label: formatDateLong(d1), description: "Next working day", patches: [bk("readyDate", d1)] },
        { label: formatDateLong(d2), patches: [bk("readyDate", d2)] },
        { label: formatDateLong(d3), description: "In a week", patches: [bk("readyDate", d3)] },
      ],
      other: { placeholder: "Another date, e.g. 12 Nov", examples: [] },
    });
  }
  if (q.length < 3 && !b.priority)
    q.push({
      id: "priority", header: "Priority", text: "What matters most for this shipment?",
      options: [
        { label: "Balanced", description: "Best overall: weighs price against time in transit and late-delivery risk", recommended: true, patches: [bk("priority", "Balanced")] },
        { label: "Cheapest", description: "Lowest freight price", patches: [bk("priority", "Cheapest")] },
        { label: "Fastest", description: "Fewest days in transit", patches: [bk("priority", "Fastest")] },
        { label: "Most reliable", description: "Highest on-time rate", patches: [bk("priority", "Most reliable")] },
      ],
      other: { placeholder: "Or tell me a date it must arrive by", examples: ["It must arrive by 20 Nov"] },
    });
  if (q.length < 3 && b.destType === "Warehouse" && b.appointment == null)
    q.push({
      id: "slot", header: "Delivery slot", text: "Have you booked a delivery slot at the receiving warehouse?",
      hint: "Warehouses turn away trucks without one.",
      options: [
        { label: "Yes, it's booked", patches: [bk("appointment", true)] },
        { label: "Not yet", description: "We'll flag it and give you the delivery date to book", patches: [bk("appointment", false)] },
      ],
    });
  if (q.length < 3 && !b.incoterm && b.destType) {
    const rec = effectiveIncoterm(b).term;
    q.push({
      id: "incoterm", header: "Incoterm", text: "Who pays EU import duty and VAT?",
      hint: b.destType === "Warehouse" ? "Fulfilment and marketplace warehouses usually expect you to be the importer (DDP)." : "Business customers usually clear import themselves (DAP).",
      options: (["DDP", "DAP"] as const)
        .map((t) => ({ label: t === "DDP" ? "I pay (DDP)" : "My receiver pays (DAP)", description: `${INCOTERMS[t].name}. ${INCOTERMS[t].who}`, recommended: t === rec, patches: [bk("incoterm", t)] }))
        .sort((x, y) => Number(!!y.recommended) - Number(!!x.recommended)),
    });
  }
  if (q.length < 3 && !b.sellerName)
    q.push({
      id: "seller", header: "Business", text: "What's your business name?",
      hint: "It goes on the commercial invoice as the exporter.",
      options: [],
      other: { placeholder: "e.g. Northfield Goods Ltd", examples: [] },
    });

  return { questions: q.slice(0, 3), complete: q.length === 0 };
}
