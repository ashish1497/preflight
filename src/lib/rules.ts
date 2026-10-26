import { MODEL } from "./reference";
import { compareIso, formatDate, nextBusinessDay } from "./dates";
import { DG_HS_PREFIXES, describeHs, type HsLookup, type HsMatch } from "./hs";
import { evaluateCarriers, gbp } from "./carriers";
import type { Booking, Issue, Item, QuickFix } from "./types";

const fmt = (n: number, dp = 2) => n.toLocaleString("en-GB", { maximumFractionDigits: dp });
const itemName = (it: Item, i: number) => (it.sku ? `${it.sku}` : `Item ${i + 1}`);
const num = (n: number | null | undefined) => (typeof n === "number" && isFinite(n) ? n : null);

export function sumItems(b: Booking) {
  let value = 0, cartons = 0, net = 0;
  for (const it of b.items) {
    value += (num(it.quantity) ?? 0) * (num(it.unitPrice) ?? 0);
    cartons += num(it.cartons) ?? 0;
    net += (num(it.unitWeight) ?? 0) * (num(it.quantity) ?? 0);
  }
  return { value, cartons, net };
}

const ICS2 = " EU pre-arrival filing (ICS2) needs at least a 6-digit HS code and a precise description.";

// --- R-06 not accepted on road groupage (dangerous goods) -------------------------------------------------
// Strong terms are clearly banned. Weak terms usually are, so we ask the seller to check.
const DG_STRONG: { re: RegExp; label: string }[] = [
  { re: /\blithium\b|\bli-?ion\b|\bli-?po(ly(mer)?)?\b|\blipo\b/i, label: "lithium battery" },
  { re: /\bpower ?banks?\b|\be-?cig(arette)?s?\b|\bvapes?\b|\bvaping\b|\be-?bikes?\b|\be-?scooters?\b|\bhoverboards?\b/i, label: "contains a lithium battery" },
  { re: /\baerosols?\b|\bspray ?(can|paint)s?\b|\bhair ?spray\b|\bdeodorant spray\b|\bbody spray\b|\bspray deodorant\b/i, label: "aerosol" },
  { re: /\bperfumes?\b|\beau de (toilette|parfum|cologne)\b|\bcolognes?\b|\bbody mists?\b|\baftershaves?\b|\bafter[- ]shave\b/i, label: "perfume / aftershave (flammable liquid)" },
  { re: /\bcamping gas\b|\bgas (cartridges?|canisters?|cylinders?)\b/i, label: "gas cartridge (flammable gas)" },
  { re: /\be-?liquids?\b|\bvape (juice|liquid)s?\b/i, label: "e-liquid (nicotine / flammable liquid)" },
  { re: /\bnail (polish|varnish)\b|\blighter (fluid|gas|refill)\b|\bbutane\b|\bpropane\b|\bpetrol\b|\bgasoline\b|\bkerosene\b|\bparaffin\b|\bmethylated spirits?\b|\bisopropyl\b|\bethanol\b|\bmethanol\b|\bacetone\b|\b(paint )?thinners?\b|\bturpentine\b|\bflammable\b|\bhand sanitis(er|er gel)\b|\bmatches\b|\bfirelighters?\b/i, label: "flammable liquid / substance" },
];
const DG_WEAK: { re: RegExp; label: string }[] = [
  { re: /\bbatter(y|ies)\b|\brechargeable\b|\bcordless\b|\bwireless (earbuds|headphones|speaker)\b|\bsmart ?watch(es)?\b|\blaptops?\b|\bmobile phones?\b|\bsmartphones?\b|\btablets? \(?pc\)?\b/i, label: "may contain a lithium battery" },
  { re: /\bdrones?\b|\bquadcopters?\b/i, label: "may contain a lithium battery" },
  { re: /\bmagnets?\b/i, label: "may be strong magnets" },
  { re: /\bspray\b/i, label: "may be an aerosol" },
  { re: /\bsolvent\b|\bvarnish\b|\blacquer\b|\bglue\b|\badhesive\b|\b(oil|spirit)[- ]based\b|\bcandle oil\b|\blamp oil\b|\bessential oils?\b|\bspirits\b|\bvodka\b|\bwhisk(e)?y\b|\bgin\b|\brum\b/i, label: "may be a flammable liquid" },
];

function dangerousGoods(it: Item): { strong: string[]; weak: string[] } {
  const strong = new Set<string>(), weak = new Set<string>();
  const text = `${it.description} ${it.sku}`;
  for (const t of DG_STRONG) if (t.re.test(text)) strong.add(t.label);
  if (it.hsCode) for (const p of DG_HS_PREFIXES) if (it.hsCode.startsWith(p.prefix)) strong.add(`HS ${it.hsCode} = ${p.label}`);
  if (!strong.size) for (const t of DG_WEAK) if (t.re.test(text)) weak.add(t.label);
  return { strong: [...strong], weak: [...weak] };
}

// --- D-01 vague descriptions ------------------------------------------------
const VAGUE = new Set([
  "gift", "gifts", "sample", "samples", "parts", "spare parts", "spares", "goods", "merchandise", "stuff",
  "items", "item", "products", "product", "accessories", "various", "misc", "miscellaneous", "mixed",
  "general cargo", "personal effects", "personal items", "consolidated", "freight", "stock", "consumer goods",
  "clothes", "clothing", "apparel", "electronics", "toys", "tools", "food", "household goods", "equipment",
]);

function isVague(desc: string): boolean {
  const d = desc.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!d) return true;
  if (VAGUE.has(d)) return true;
  const words = d.split(" ");
  return words.length <= 2 && words.every((w) => VAGUE.has(w) || ["and", "of", "for", "new", "assorted", "box", "boxes"].includes(w));
}

export function checkBooking(b: Booking, today: string, hs: HsLookup | null): Issue[] {
  const issues: Issue[] = [];
  const s = sumItems(b);

  // --- Data completeness: things we need before rules can run.
  if (!b.items.length)
    issues.push({ rule: "DATA", severity: "red", title: "No items on this booking", detail: "There are no product lines for this booking, so value, cartons and weight can't be checked.", fix: "Add the products in this shipment (Items sheet, same Booking ID)." });
  const missing: string[] = [];
  if (!b.destCity || !b.destCountry) missing.push("destination");
  if (num(b.pallets) == null || b.pallets! <= 0) missing.push("pallets");
  if (num(b.grossWeight) == null) missing.push("total gross weight");
  if (num(b.cartons) == null) missing.push("total cartons");
  if (num(b.declaredValue) == null) missing.push("total declared value");
  if (missing.length)
    issues.push({ rule: "DATA", severity: "red", title: `Missing: ${missing.join(", ")}`, detail: "These booking fields are blank or not numbers, so some checks can't run.", fix: `Fill in ${missing.join(", ")}.` });

  b.items.forEach((it, i) => {
    const n = itemName(it, i);

    // R-01 HS code
    if (!it.hsCode) {
      issues.push({ rule: "R-01", severity: "red", itemIndex: i, title: `${n}: HS code missing`, detail: `"${it.description}" has no HS code. Customs can't classify it.${ICS2}`, fix: "Add the HS (commodity) code for this product, at least 6 digits. You can look it up on the UK Trade Tariff." });
    } else {
      // Compare against the tariff list exactly as published (7 or 8 digits).
      const info = describeHs(it.hsCode, hs);
      const pick = (ms: HsMatch[]) => ms.slice(0, 8).map((m) => ({ label: `${m.code} · ${m.description.slice(0, 40)}${m.description.length > 40 ? "…" : ""}`, patches: [{ kind: "item" as const, index: i, field: "hsCode" as const, value: m.code }] }));
      // A longer code (e.g. a 10-digit import code) whose start is a listed code.
      const parent = hs && !info.exact && !info.matches.length ? [8, 7].map((n) => it.hsCode!.slice(0, n)).find((c) => c in hs.codes) : undefined;
      if (it.hsCode.length < 6)
        issues.push({
          rule: "R-01", severity: "red", itemIndex: i,
          title: `${n}: HS code ${it.hsCode} is only ${it.hsCode.length} digits`,
          detail: info.matches.length
            ? `HS codes need at least 6 digits. ${it.hsCode} matches ${info.matches.length} code${info.matches.length > 1 ? "s" : ""} in the 2026 tariff list, e.g. ${info.matches[0].code} (${info.matches[0].description}). Digits may have been lost in the spreadsheet.${ICS2}`
            : `HS codes need at least 6 digits to identify the product.${ICS2}`,
          fix: info.matches.length ? "Use the full code from the tariff list." : "Give the full code (at least 6 digits).",
          quickFixes: info.matches.length ? pick(info.matches) : undefined,
        });
      else if (hs && !info.exact && info.matches.length)
        issues.push({
          rule: "R-01", severity: "info", itemIndex: i,
          title: `${n}: ${it.hsCode} isn't a full code in the tariff list`,
          detail: `The 2026 tariff list has ${info.matches.length} code${info.matches.length > 1 ? "s" : ""} starting ${it.hsCode}. Declarations use the full listed code.`,
          fix: info.matches.length === 1 ? `Use ${info.matches[0].code}.` : "Pick the one that matches the product.",
          quickFixes: pick(info.matches),
        });
      else if (hs && parent)
        issues.push({
          rule: "R-01", severity: "info", itemIndex: i,
          title: `${n}: tariff list code is ${parent}`,
          detail: `${it.hsCode} starts with ${parent} (${hs.codes[parent]}), the code listed in the 2026 tariff list.`,
          fix: `Use ${parent} on export paperwork.`,
          quickFixes: [{ label: `Use ${parent}`, patches: [{ kind: "item", index: i, field: "hsCode", value: parent }] }],
        });
      else if (hs && !info.exact)
        issues.push({ rule: "R-01", severity: "info", itemIndex: i, title: `${n}: HS ${it.hsCode} not found in the 2026 tariff list`, detail: "The code has 6+ digits, so this check passes, but it isn't in the 2026 tariff list. It may be outdated or mistyped.", fix: "Double-check the code on the UK Trade Tariff before collection." });
    }

    // R-03 units per carton × cartons = quantity
    const upc = num(it.unitsPerCarton), ctn = num(it.cartons), qty = num(it.quantity);
    if (upc != null && ctn != null && qty != null && upc * ctn !== qty) {
      const fixes: QuickFix[] = [{ label: `Quantity → ${fmt(upc * ctn)}`, patches: [{ kind: "item", index: i, field: "quantity", value: upc * ctn }] }];
      const exact = qty / upc;
      if (Number.isInteger(exact)) fixes.push({ label: `Cartons → ${exact}`, patches: [{ kind: "item", index: i, field: "cartons", value: exact }] });
      issues.push({
        rule: "R-03", severity: "red", itemIndex: i,
        title: `${n}: ${fmt(upc)} per carton × ${fmt(ctn)} cartons = ${fmt(upc * ctn)}, but quantity says ${fmt(qty)}`,
        detail: `A difference of ${fmt(Math.abs(upc * ctn - qty))} units. The receiving warehouse will report units missing or extra.`,
        fix: Number.isInteger(exact)
          ? `Either the quantity is ${fmt(upc * ctn)}, or there are ${exact} cartons. Count one carton and fix whichever is wrong.`
          : `Either the quantity is ${fmt(upc * ctn)}, or the units per carton is wrong (${fmt(qty)} ÷ ${fmt(ctn)} = ${fmt(qty / ctn)} isn't whole). Count one carton.`,
        quickFixes: fixes,
      });
    } else if (upc == null || ctn == null || qty == null) {
      issues.push({ rule: "R-03", severity: "red", itemIndex: i, title: `${n}: can't check carton count`, detail: "Quantity, units per carton or cartons is blank.", fix: "Fill in all three so the count can be checked." });
    }

    // R-06 dangerous goods
    const dg = dangerousGoods(it);
    if (dg.strong.length)
      issues.push({ rule: "R-06", severity: "red", itemIndex: i, title: `${n}: not allowed (${dg.strong.join("; ")})`, detail: `"${it.description}" isn't accepted on road groupage: no lithium batteries, aerosols, flammable liquids or gases on these services.`, fix: "Remove this item from the shipment, or ship it separately with a dangerous-goods (ADR) carrier." });
    else if (dg.weak.length)
      issues.push({ rule: "R-06", severity: "amber", itemIndex: i, title: `${n}: check for dangerous goods (${dg.weak.join("; ")})`, detail: `"${it.description}" might contain a lithium battery, aerosol, flammable liquid or strong magnets, which road groupage doesn't accept.`, fix: "Confirm it doesn't. If it does, remove it from this shipment." });

    // R-09 country of origin
    if (!it.countryOfOrigin)
      issues.push({ rule: "R-09", severity: "amber", itemIndex: i, title: `${n}: country of origin missing`, detail: "Customs uses it to work out duty. UK-made goods can enter the EU duty-free under the UK–EU trade deal; others usually pay duty.", fix: "Add where the product was made (not where it ships from)." });

    // D-01 description specific enough for customs
    if (isVague(it.description))
      issues.push({ rule: "D-01", severity: "amber", itemIndex: i, title: `${n}: description "${it.description || "(blank)"}" is too vague for customs`, detail: `EU customs reject vague descriptions such as "gifts", "parts" or "samples" in pre-arrival checks.${ICS2}`, fix: "Say what it is, what it's made of and what it's for, e.g. \"Ceramic coffee mug, 350 ml\"." });
  });

  // R-02 declared value
  if (b.items.length && num(b.declaredValue) != null) {
    const diff = b.declaredValue! - s.value;
    const pct = s.value ? Math.abs(diff) / s.value : diff ? 1 : 0;
    if (pct > MODEL.valueTolerance)
      issues.push({
        rule: "R-02", severity: "red",
        title: `Declared value ${gbp(b.declaredValue!)} ≠ items total ${gbp(s.value)}`,
        detail: `The items add up to ${gbp(s.value)} (quantity × unit price). The declared value is ${diff > 0 ? "over" : "under"} by ${gbp(Math.abs(diff))} (${(pct * 100).toFixed(1)}%), beyond the 1% allowed. Customs will question the invoice.`,
        fix: `Set the declared value to ${gbp(s.value)}, or correct the item prices/quantities if those are wrong.`,
        quickFixes: [{ label: `Declared value → ${gbp(s.value)}`, patches: [{ kind: "booking", field: "declaredValue", value: Math.round(s.value * 100) / 100 }] }],
      });
  }

  // R-04 total cartons
  if (b.items.length && num(b.cartons) != null && b.cartons !== s.cartons)
    issues.push({
      rule: "R-04", severity: "red",
      title: `Booking says ${fmt(b.cartons!)} cartons, items add up to ${fmt(s.cartons)}`,
      detail: `${b.items.map((it, i) => `${itemName(it, i)}: ${it.cartons ?? "?"}`).join(" + ")} = ${fmt(s.cartons)}. Carton labels ("1 of N") and the warehouse count will not match.`,
      fix: `Set total cartons to ${fmt(s.cartons)}, or fix the item that's off.`,
      quickFixes: [{ label: `Total cartons → ${fmt(s.cartons)}`, patches: [{ kind: "booking", field: "cartons", value: s.cartons }] }],
    });

  // R-05 weight per pallet vs carriers
  if (num(b.pallets) != null && b.pallets! > 0 && num(b.grossWeight) != null) {
    const wpp = b.grossWeight! / b.pallets!;
    const evals = evaluateCarriers(b, today);
    if (evals.length && !evals.some((e) => e.fitsWeight)) {
      const maxLimit = Math.max(...evals.map((e) => e.option.maxWeightPerPallet));
      const need = Math.ceil(b.grossWeight! / maxLimit);
      issues.push({
        rule: "R-05", severity: "red",
        title: `${fmt(wpp, 0)} kg per pallet is too heavy for every carrier`,
        detail: `${fmt(b.grossWeight!)} kg ÷ ${b.pallets} pallets = ${fmt(wpp, 0)} kg per pallet. The highest limit on this route is ${maxLimit} kg.`,
        fix: `Spread the load over at least ${need} pallets (${fmt(b.grossWeight! / need, 0)} kg each), or check the weight.`,
        quickFixes: [{ label: `Pallets → ${need}`, patches: [{ kind: "booking", field: "pallets", value: need }] }],
      });
    }
  }

  // R-07 gross weight ≥ net weight
  if (b.items.length && num(b.grossWeight) != null && b.grossWeight! < s.net) {
    const est = Math.ceil(s.net + (b.cartons ?? s.cartons) * MODEL.kgPerCarton + (b.pallets ?? 0) * MODEL.kgPerPallet);
    issues.push({
      rule: "R-07", severity: "amber",
      title: `Gross weight ${fmt(b.grossWeight!)} kg is less than the goods alone (${fmt(s.net)} kg)`,
      detail: `Unit weight × quantity across items = ${fmt(s.net)} kg, before cartons and pallets. Weighbridge checks will flag this.`,
      fix: `Re-weigh the shipment. With packaging it's likely around ${fmt(est, 0)} kg (goods + ~${MODEL.kgPerCarton} kg per carton + ~${MODEL.kgPerPallet} kg per pallet).`,
      quickFixes: [{ label: `Gross weight → ${fmt(est, 0)} kg (estimate)`, patches: [{ kind: "booking", field: "grossWeight", value: est }] }],
    });
  }

  // R-08 warehouse appointment
  if (b.destType === "Warehouse" && b.appointment !== true)
    issues.push({
      rule: "R-08", severity: "amber",
      title: "No delivery appointment at the receiving warehouse",
      detail: "Warehouses turn away trucks without a booked slot, so the goods wait (and you pay) until one is free.",
      fix: "Book a delivery slot with the warehouse for the estimated delivery date shown below.",
      quickFixes: [{ label: "I've booked a slot", patches: [{ kind: "booking", field: "appointment", value: true }] }],
    });

  // R-10 ready date
  if (!b.readyDate)
    issues.push({ rule: "R-10", severity: "amber", title: "Ready to ship date missing or unreadable", detail: "We can't schedule collection without it.", fix: "Give the date as DD-MM-YYYY.", quickFixes: [{ label: `Use ${formatDate(nextBusinessDay(today))}`, patches: [{ kind: "booking", field: "readyDate", value: nextBusinessDay(today) }] }] });
  else if (compareIso(b.readyDate, today) < 0)
    issues.push({ rule: "R-10", severity: "amber", title: `Ready date ${formatDate(b.readyDate)} is in the past`, detail: `Today is ${formatDate(today)}. A carrier can't collect in the past.`, fix: "Set the date the goods will actually be packed and ready.", quickFixes: [{ label: `Use ${formatDate(nextBusinessDay(today))}`, patches: [{ kind: "booking", field: "readyDate", value: nextBusinessDay(today) }] }] });

  const order = { red: 0, amber: 1, info: 2 };
  return issues.sort((a, b2) => order[a.severity] - order[b2.severity] || a.rule.localeCompare(b2.rule));
}
