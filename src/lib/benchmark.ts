// Seeded-error benchmark (method: Arocena et al. 2015; Abedjan et al. 2016; Andrews et al. 2005).
// 1. Generate correct bookings. 2. Plant known mistakes by rule (one check per mistake type).
// 3. Run the checks. 4. Score against the answer key: recall per type, false alarms on clean data.
import { analyze } from "./analyze";
import { DEST_CITIES, MODEL, ORIGIN_CITIES, PRIORITIES } from "./reference";
import { addBusinessDays } from "./dates";
import type { HsLookup } from "./hs";
import type { Booking, DestType, Item } from "./types";

/** Deterministic random numbers so every run is identical (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ordinary products with exact codes from the 2026 tariff list.
const PRODUCTS: Omit<Item, "sku" | "quantity" | "cartons">[] = [
  { description: "Men's cotton T-shirt, size M", hsCode: "61091000", unitPrice: 6, unitsPerCarton: 20, unitWeight: 0.2, countryOfOrigin: "India" },
  { description: "Stoneware coffee mug, 300 ml", hsCode: "69120023", unitPrice: 3, unitsPerCarton: 24, unitWeight: 0.4, countryOfOrigin: "United Kingdom" },
  { description: "A5 exercise notebook, 80 pages", hsCode: "48202000", unitPrice: 2.5, unitsPerCarton: 25, unitWeight: 0.3, countryOfOrigin: "United Kingdom" },
  { description: "Black ballpoint pen, liquid ink", hsCode: "96081010", unitPrice: 0.8, unitsPerCarton: 100, unitWeight: 0.02, countryOfOrigin: "China" },
  { description: "Cast iron skillet, 26 cm", hsCode: "73239100", unitPrice: 18, unitsPerCarton: 6, unitWeight: 5, countryOfOrigin: "China" },
  { description: "Wool throw blanket, 130 x 170 cm", hsCode: "63012010", unitPrice: 22, unitsPerCarton: 10, unitWeight: 1.2, countryOfOrigin: "Turkey" },
  { description: "Glazed ceramic floor tile, 30 x 30 cm", hsCode: "69072100", unitPrice: 6.5, unitsPerCarton: 10, unitWeight: 1.1, countryOfOrigin: "Turkey" },
  { description: "Mechanical wristwatch, steel case", hsCode: "91022100", unitPrice: 150, unitsPerCarton: 20, unitWeight: 0.3, countryOfOrigin: "Germany" },
  { description: "Leather handbag with shoulder strap", hsCode: "42022210", unitPrice: 35, unitsPerCarton: 8, unitWeight: 0.9, countryOfOrigin: "India" },
  { description: "Roasted coffee beans, 1 kg bag", hsCode: "9012100", unitPrice: 12, unitsPerCarton: 10, unitWeight: 1.05, countryOfOrigin: "Vietnam" },
  { description: "Men's cotton denim jeans", hsCode: "62034231", unitPrice: 14, unitsPerCarton: 12, unitWeight: 0.7, countryOfOrigin: "Turkey" },
  { description: "Plastic picnic plate set", hsCode: "39241000", unitPrice: 4, unitsPerCarton: 30, unitWeight: 0.25, countryOfOrigin: "China" },
];

export const MISTAKES = ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09", "R-10", "D-01"] as const;
export type Mistake = (typeof MISTAKES)[number];

const MISTAKE_TEXT: Record<Mistake, string> = {
  "R-01": "HS code blank or cut short",
  "R-02": "Declared value off by 3–25%",
  "R-03": "Units per carton don't match quantity",
  "R-04": "Booking carton total off",
  "R-05": "Pallets too heavy for every carrier",
  "R-06": "Restricted item (lithium battery / perfume)",
  "R-07": "Gross weight below goods weight",
  "R-08": "Warehouse with no delivery slot",
  "R-09": "Country of origin blank",
  "R-10": "Ready date in the past",
  "D-01": "Vague description (\"Gifts\")",
};
export const mistakeText = (m: string) => MISTAKE_TEXT[m as Mistake] ?? BLIND_TEXT[m as Blind] ?? m;

// Realistic mistakes no rule can see: the data is internally consistent but wrong.
export const BLIND = ["X-HS", "X-ORIGIN", "X-PRICE"] as const;
export type Blind = (typeof BLIND)[number];
const BLIND_TEXT: Record<Blind, string> = {
  "X-HS": "Valid HS code for the wrong product",
  "X-ORIGIN": "Wrong (but valid) country of origin",
  "X-PRICE": "Unit price typo ×10, totals updated to match",
};

export interface Seeded {
  booking: Booking;
  /** Planted mistakes (empty = correct booking). */
  planted: Mistake[];
  /** Planted mistakes outside the rulebook (scored separately). */
  blind?: Blind;
  /** Correct but close to a limit, to test for false alarms. */
  edgeCase?: string;
}

function cleanBooking(r: () => number, n: number, today: string): Booking {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const used = new Set<number>();
  const items: Item[] = [];
  const count = 1 + Math.floor(r() * 3);
  while (items.length < count) {
    const p = Math.floor(r() * PRODUCTS.length);
    if (used.has(p)) continue;
    used.add(p);
    const base = PRODUCTS[p];
    const cartons = 5 + Math.floor(r() * 40);
    items.push({ ...base, sku: `P${p}-${items.length + 1}`, cartons, quantity: cartons * base.unitsPerCarton! });
  }
  const value = items.reduce((s, i) => s + i.quantity! * i.unitPrice!, 0);
  const cartons = items.reduce((s, i) => s + i.cartons!, 0);
  const net = items.reduce((s, i) => s + i.quantity! * i.unitWeight!, 0);
  const pallets = Math.max(1, Math.ceil((net + cartons * MODEL.kgPerCarton) / 380));
  const gross = Math.ceil(net + cartons * MODEL.kgPerCarton + pallets * MODEL.kgPerPallet);
  const destCity = pick(Object.keys(DEST_CITIES));
  const destType: DestType = r() < 0.6 ? "Warehouse" : "Business address";
  return {
    id: `SB-${String(n).padStart(3, "0")}`,
    sellerName: `Seller ${n}`,
    originCity: pick(ORIGIN_CITIES),
    originCountry: "United Kingdom",
    destCity,
    destCountry: DEST_CITIES[destCity],
    destType,
    readyDate: addBusinessDays(today, 2 + Math.floor(r() * 15)),
    priority: pick(PRIORITIES),
    pallets,
    cartons,
    declaredValue: Math.round(value * 100) / 100,
    currency: "GBP",
    grossWeight: gross,
    appointment: destType === "Warehouse" ? true : false,
    items,
  };
}

/** Apply one mistake type by rule. Each operator is built to trip exactly one check. */
function plant(b: Booking, m: Mistake, r: () => number, today: string): Booking {
  const x: Booking = { ...b, items: b.items.map((i) => ({ ...i })) };
  const it = x.items[Math.floor(r() * x.items.length)];
  const net = x.items.reduce((s, i) => s + i.quantity! * i.unitWeight!, 0);
  switch (m) {
    case "R-01":
      it.hsCode = r() < 0.5 ? null : it.hsCode!.slice(0, 5); // blank, or digits lost in the spreadsheet
      break;
    case "R-02": {
      const off = 0.03 + r() * 0.22;
      x.declaredValue = Math.round(x.declaredValue! * (r() < 0.5 ? 1 - off : 1 + off) * 100) / 100;
      break;
    }
    case "R-03":
      it.unitsPerCarton = it.unitsPerCarton! + 1 + Math.floor(r() * 3); // quantity and cartons unchanged
      break;
    case "R-04":
      x.cartons = x.cartons! + (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 4));
      break;
    case "R-05":
      x.grossWeight = Math.ceil(x.pallets! * (760 + r() * 300)); // over the 750 kg max on every service
      break;
    case "R-06": {
      const banned = r() < 0.5
        ? { description: "Power bank 10000 mAh, USB-C", hsCode: "85076000" }
        : { description: "Eau de parfum, 50 ml", hsCode: "33030010" };
      Object.assign(it, banned);
      break;
    }
    case "R-07":
      x.grossWeight = Math.max(1, Math.floor(net * (0.6 + r() * 0.3)));
      break;
    case "R-08":
      x.destType = "Warehouse";
      x.appointment = false;
      break;
    case "R-09":
      it.countryOfOrigin = null;
      break;
    case "R-10": {
      // addBusinessDays only counts forward, so step back with plain date arithmetic.
      const d = new Date(today + "T12:00:00");
      d.setDate(d.getDate() - (3 + Math.floor(r() * 20)));
      x.readyDate = d.toISOString().slice(0, 10);
      break;
    }
    case "D-01":
      it.description = r() < 0.5 ? "Gifts" : "Samples";
      break;
  }
  return x;
}

/** Correct bookings sitting right at a limit: a good checker must NOT flag these. */
function edgeCase(b: Booking, k: number, r: () => number, today: string): { booking: Booking; label: string } {
  const x: Booking = { ...b, items: b.items.map((i) => ({ ...i })) };
  switch (k % 5) {
    case 0:
      x.declaredValue = Math.round(x.declaredValue! * (r() < 0.5 ? 0.992 : 1.008) * 100) / 100;
      return { booking: x, label: "Declared value within the 1% tolerance" };
    case 1: {
      const net = x.items.reduce((s, i) => s + i.quantity! * i.unitWeight!, 0);
      x.grossWeight = Math.ceil(net);
      return { booking: x, label: "Gross weight equal to goods weight" };
    }
    case 2:
      x.grossWeight = 750 * x.pallets!;
      return { booking: x, label: "Exactly 750 kg per pallet (standard service limit)" };
    case 3:
      x.readyDate = today;
      return { booking: x, label: "Ready date is today" };
    default:
      x.destType = "Business address";
      x.appointment = false;
      return { booking: x, label: "Business address with no delivery slot" };
  }
}

export function generate(opts: { seed: number; clean: number; edge: number; perMistake: number; today: string }): Seeded[] {
  const r = rng(opts.seed);
  const out: Seeded[] = [];
  let n = 1;
  for (let i = 0; i < opts.clean; i++) out.push({ booking: cleanBooking(r, n++, opts.today), planted: [] });
  for (let i = 0; i < opts.edge; i++) {
    const e = edgeCase(cleanBooking(r, n++, opts.today), i, r, opts.today);
    out.push({ booking: e.booking, planted: [], edgeCase: e.label });
  }
  // Single mistakes: perMistake bookings per type, so recall per type is measured cleanly.
  for (const m of MISTAKES)
    for (let i = 0; i < opts.perMistake; i++) out.push({ booking: plant(cleanBooking(r, n++, opts.today), m, r, opts.today), planted: [m] });
  // Mixed: 2–3 different mistakes in one booking, as real sheets have.
  for (let i = 0; i < opts.perMistake; i++) {
    let b = cleanBooking(r, n++, opts.today);
    const ms = [...MISTAKES].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 2)) as Mistake[];
    // R-05 and R-07 both set gross weight; keep one so the mistakes don't cancel out.
    const chosen = ms.includes("R-05") ? ms.filter((m) => m !== "R-07") : ms;
    for (const m of chosen) b = plant(b, m, r, opts.today);
    out.push({ booking: b, planted: chosen });
  }
  // Outside the rulebook: consistent-looking but wrong data.
  for (const m of BLIND)
    for (let i = 0; i < opts.perMistake; i++) {
      const b = cleanBooking(r, n++, opts.today);
      const it = b.items[0];
      if (m === "X-HS") it.hsCode = PRODUCTS.find((p) => p.hsCode !== it.hsCode)!.hsCode;
      if (m === "X-ORIGIN") it.countryOfOrigin = it.countryOfOrigin === "China" ? "United Kingdom" : "China";
      if (m === "X-PRICE") {
        it.unitPrice = it.unitPrice! * 10;
        b.declaredValue = Math.round(b.items.reduce((s2, x) => s2 + x.quantity! * x.unitPrice!, 0) * 100) / 100;
      }
      out.push({ booking: b, planted: [], blind: m });
    }
  // Shuffle so mistakes aren't grouped (matters for human reviewers).
  return out.sort(() => r() - 0.5).map((s, i) => ({ ...s, booking: { ...s.booking, id: `SB-${String(i + 1).padStart(3, "0")}` } }));
}

export interface Report {
  bookings: number;
  withMistakes: number;
  plantedTotal: number;
  caught: number;
  recall: number;
  perType: { mistake: Mistake; text: string; planted: number; caught: number }[];
  correctBookings: number;
  falseAlarmBookings: number;
  falseAlarmRate: number;
  edgeCases: { label: string; flagged: boolean }[];
  extraFlags: number;
  blockedCorrectly: number;
  redPlantedBookings: number;
  msPerBooking: number;
  misses: { id: string; mistake: string }[];
  blind: { type: Blind; text: string; planted: number; caught: number }[];
  falseAlarms: { id: string; flags: string[] }[];
}

/** Run the checks on every seeded booking and score against the answer key. */
export function score(data: Seeded[], hs: HsLookup, today: string): Report {
  const perType = new Map<Mistake, { planted: number; caught: number }>(MISTAKES.map((m) => [m, { planted: 0, caught: 0 }]));
  let caught = 0, planted = 0, falseAlarmBookings = 0, extraFlags = 0, blockedCorrectly = 0, redPlanted = 0;
  const blindCaught = new Map<Blind, number>();
  const misses: Report["misses"] = [], falseAlarms: Report["falseAlarms"] = [], edges: Report["edgeCases"] = [];
  const t0 = performance.now();
  const results = data.map((s) => ({ s, a: analyze(s.booking, today, hs) }));
  const ms = (performance.now() - t0) / data.length;
  const RED = new Set(["R-01", "R-02", "R-03", "R-04", "R-05", "R-06"]);

  for (const { s, a } of results) {
    // Only warnings and blockers count as flags; info notes don't.
    const flagged = new Set(a.issues.filter((i) => i.severity !== "info").map((i) => i.rule));
    if (s.blind) {
      if (flagged.size) blindCaught.set(s.blind, (blindCaught.get(s.blind) ?? 0) + 1);
      continue;
    }
    if (!s.planted.length) {
      if (flagged.size) {
        falseAlarmBookings++;
        falseAlarms.push({ id: s.booking.id, flags: [...flagged] });
      }
      if (s.edgeCase) edges.push({ label: s.edgeCase, flagged: flagged.size > 0 });
      continue;
    }
    for (const m of s.planted) {
      planted++;
      perType.get(m)!.planted++;
      if (flagged.has(m)) {
        caught++;
        perType.get(m)!.caught++;
      } else misses.push({ id: s.booking.id, mistake: m });
    }
    for (const f of flagged) if (!s.planted.includes(f as Mistake)) extraFlags++;
    if (s.planted.some((m) => RED.has(m))) {
      redPlanted++;
      if (a.status === "blocked") blockedCorrectly++;
    }
  }
  const correct = data.filter((s) => !s.planted.length && !s.blind).length;
  return {
    bookings: data.length,
    withMistakes: data.length - correct - data.filter((s) => s.blind).length,
    plantedTotal: planted,
    caught,
    recall: planted ? caught / planted : 0,
    perType: MISTAKES.map((m) => ({ mistake: m, text: MISTAKE_TEXT[m], ...perType.get(m)! })),
    correctBookings: correct,
    falseAlarmBookings,
    falseAlarmRate: correct ? falseAlarmBookings / correct : 0,
    edgeCases: edges,
    extraFlags,
    blockedCorrectly,
    redPlantedBookings: redPlanted,
    msPerBooking: ms,
    misses,
    falseAlarms,
    blind: BLIND.map((b) => ({ type: b, text: BLIND_TEXT[b], planted: data.filter((s) => s.blind === b).length, caught: blindCaught.get(b) ?? 0 })),
  };
}
