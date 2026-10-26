import { collectionDate, gbp } from "./carriers";
import { formatDateLong } from "./dates";
import { effectiveIncoterm } from "./reference";
import type { Analysis, Booking } from "./types";

/** SC-YYMMDD-NNNN-C, where C = NNNN mod 7 (the same self-check air waybills use), so a mistyped reference is caught. */
export function bookingRef(today: string, seed: string): string {
  let h = 0;
  for (const ch of seed + today) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const serial = 1000 + (h % 9000);
  return `SC-${today.slice(2).replace(/-/g, "")}-${serial}-${serial % 7}`;
}

export function isValidRef(ref: string): boolean {
  const m = ref.match(/^SC-\d{6}-(\d{4})-(\d)$/);
  return !!m && Number(m[1]) % 7 === Number(m[2]);
}

export interface Step {
  when: string;
  who: "You" | "Preflight" | "Carrier" | "Customs" | "Warehouse";
  what: string;
}

const COUNTRY_CODE: Record<string, string> = { Germany: "DE", France: "FR", Netherlands: "NL" };

/** Format check only (GB or XI + 12 digits); it doesn't confirm the number is registered. */
export const isUkEori = (v: string) => /^(GB|XI)\d{12}$/.test(v.replace(/\s/g, "").toUpperCase());
/** EU EORI / VAT: destination country code + up to 15 letters/digits. Format check only. */
export const isEuId = (v: string, cc?: string) => {
  const s = v.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}[0-9A-Z]{1,15}$/.test(s) && (!cc || s.startsWith(cc));
};

/** Details the seller still has to give before collection (EORI, receiver), with format checks. */
export function neededFromYou(b: Booking) {
  return [
      (() => {
        const v = b.exporterEori?.trim();
        const err = v && !isUkEori(v) ? "UK EORI is GB followed by 12 digits, e.g. GB123456789000." : undefined;
        return { key: "exporter", name: "Your UK EORI number", done: !!v && !err, error: err, note: v && !err ? v : "Customs ID for exporters (GB + 12 digits). Needed for the UK export declaration.", fields: [{ field: "exporterEori" as const, label: "UK EORI", placeholder: "GB123456789000" }] };
      })(),
      {
        key: "consignee", name: "Receiver's name and address", error: undefined as string | undefined, done: !!(b.consigneeName?.trim() && b.consigneeAddress?.trim()),
        note: b.consigneeName ? `${b.consigneeName}${b.consigneeAddress ? ", " + b.consigneeAddress : " (address missing)"}` : "Who the goods are delivered to, for the invoice.",
        fields: [
          { field: "consigneeName" as const, label: "Receiver name", placeholder: "e.g. Amazon EU SARL / FRA7" },
          { field: "consigneeAddress" as const, label: "Delivery address", placeholder: `Street, postcode, ${b.destCity || "city"}` },
        ],
      },
      effectiveIncoterm(b).term === "DDP"
        ? (() => {
            const v = b.sellerEuEori?.trim();
            const err = v && !isEuId(v) ? "An EU EORI starts with the EU country code that issued it, e.g. DE123456789012345." : undefined;
            return { key: "sellerEuEori", name: "Your EU EORI (you're the importer under DDP)", done: !!v && !err, error: err, note: v && !err ? v : `Under DDP you clear import into ${b.destCountry || "the EU"} and pay duty/VAT, usually through a customs broker acting for you.`, fields: [{ field: "sellerEuEori" as const, label: "Your EU EORI", placeholder: "NL123456789" }] };
          })()
        : (() => {
        const v = b.consigneeEori?.trim();
        const cc = COUNTRY_CODE[b.destCountry];
        const err = v && !isEuId(v, cc) ? `Should start with ${cc ?? "the country code"} followed by up to 15 letters/digits, e.g. ${cc ?? "DE"}123456789.` : undefined;
        return { key: "consigneeEori", name: "Receiver's EU EORI / VAT number", done: !!v && !err, error: err, note: v && !err ? v : `So the receiver (or their customs broker) can clear import into ${b.destCountry || "the EU"}.`, fields: [{ field: "consigneeEori" as const, label: "EU EORI / VAT", placeholder: `${cc ?? "DE"}123456789` }] };
      })(),
    ];
}

/** Documents the app produces and details still needed from the seller. */
export function documentChecklist(a: Analysis) {
  const b = a.booking;
  const blockers = a.issues.filter((i) => ["R-01", "R-09"].includes(i.rule) && i.severity !== "info").length;
  const ukOrigin = b.items.filter((i) => i.countryOfOrigin === "United Kingdom");
  return {
    generated: [
      { name: "Commercial invoice", ok: blockers === 0 && b.items.length > 0, note: !b.items.length ? "Add items first." : blockers ? "Missing HS code or country of origin on some items (see HS code / Country of origin)." : "Ready. Built from your items." },
      { name: "Packing list", ok: b.items.length > 0, note: b.items.length ? `${a.computed.itemsCartons} cartons on ${b.pallets ?? "?"} pallets.` : "Add items first." },
      ...(ukOrigin.length
        ? [{ name: "Statement on origin (on the invoice)", ok: true, note: `Claims 0% EU duty for ${ukOrigin.length} UK-made item${ukOrigin.length > 1 ? "s" : ""} under the UK–EU trade deal.` }]
        : []),
    ],
    neededFromYou: neededFromYou(b),
    dutyNote: b.items.some((i) => i.countryOfOrigin && i.countryOfOrigin !== "United Kingdom")
      ? "Items made outside the UK usually pay EU import duty, even though they ship from the UK."
      : null,
  };
}

export function nextSteps(a: Analysis, today: string): Step[] {
  const b = a.booking;
  const c = a.recommendation.chosen;
  const collect = collectionDate(b, today);
  const steps: Step[] = [
    { when: "Now", who: "Preflight", what: "Commercial invoice and packing list generated. Download them below." },
    { when: "Before collection", who: "You", what: `Label every carton "1 of ${b.cartons ?? a.computed.itemsCartons}" with the booking reference, and send your EORI and the receiver's details if they're still missing.` },
  ];
  if (b.destType === "Warehouse")
    steps.push({ when: "Before collection", who: "You", what: b.appointment ? "Confirm your warehouse delivery slot matches the delivery date below." : "Book a delivery slot at the receiving warehouse for the delivery date below." });
  steps.push(
    { when: formatDateLong(collect), who: "Carrier", what: `${c ? c.option.carrier : "The carrier"} collects ${b.pallets} pallet${b.pallets === 1 ? "" : "s"} from ${b.originCity}.` },
    { when: "At the border", who: "Customs", what: "The carrier lodges the UK export declaration and the EU safety and security filing using your invoice. Your goods are cleared into the EU." },
    { when: c ? formatDateLong(c.eta) : "—", who: "Warehouse", what: `Delivered to ${b.destCity}, ${b.destCountry}. The receiver counts ${b.cartons ?? a.computed.itemsCartons} cartons against the packing list.` },
  );
  return steps;
}

export function priceLine(a: Analysis): string {
  const c = a.recommendation.chosen;
  return c ? `${gbp(c.option.pricePerPallet)} × ${a.booking.pallets} pallets = ${gbp(c.freight)}` : "—";
}
