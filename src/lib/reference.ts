import type { Booking, CarrierOption, Incoterm, Priority, Severity } from "./types";

// Carrier rate card (per pallet, GBP).
export const CARRIERS: CarrierOption[] = [
  { carrier: "Carrier A", service: "Road economy", destCountry: "Germany", pricePerPallet: 180, transitDays: 5, onTimeRate: 92, maxWeightPerPallet: 500 },
  { carrier: "Carrier B", service: "Road standard", destCountry: "Germany", pricePerPallet: 220, transitDays: 3, onTimeRate: 95, maxWeightPerPallet: 750 },
  { carrier: "Carrier C", service: "Road express", destCountry: "Germany", pricePerPallet: 340, transitDays: 2, onTimeRate: 98, maxWeightPerPallet: 400 },
  { carrier: "Carrier A", service: "Road economy", destCountry: "France", pricePerPallet: 170, transitDays: 5, onTimeRate: 92, maxWeightPerPallet: 500 },
  { carrier: "Carrier B", service: "Road standard", destCountry: "France", pricePerPallet: 210, transitDays: 3, onTimeRate: 95, maxWeightPerPallet: 750 },
  { carrier: "Carrier C", service: "Road express", destCountry: "France", pricePerPallet: 330, transitDays: 2, onTimeRate: 98, maxWeightPerPallet: 400 },
  { carrier: "Carrier A", service: "Road economy", destCountry: "Netherlands", pricePerPallet: 160, transitDays: 5, onTimeRate: 92, maxWeightPerPallet: 500 },
  { carrier: "Carrier B", service: "Road standard", destCountry: "Netherlands", pricePerPallet: 200, transitDays: 3, onTimeRate: 95, maxWeightPerPallet: 750 },
  { carrier: "Carrier C", service: "Road express", destCountry: "Netherlands", pricePerPallet: 320, transitDays: 2, onTimeRate: 98, maxWeightPerPallet: 400 },
];

// Preflight pre-flight checks. `id` is internal; `name` is what users see.
export const RULES: { id: string; name: string; rule: string; severity: Severity; advisory?: boolean }[] = [
  { id: "R-01", name: "HS code", rule: "Every item must have an HS code of at least 6 digits (EU pre-arrival filing, ICS2, needs it)", severity: "red" },
  { id: "R-02", name: "Declared value", rule: "Total declared value must equal the sum of quantity × unit price across all items (within 1%)", severity: "red" },
  { id: "R-03", name: "Carton count", rule: "For each item, units per carton × cartons must equal quantity", severity: "red" },
  { id: "R-04", name: "Total cartons", rule: "Total cartons on the booking must equal the sum of cartons across all items", severity: "red" },
  { id: "R-05", name: "Pallet weight", rule: "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet", severity: "red" },
  { id: "R-06", name: "Not accepted on road groupage", rule: "No lithium batteries, aerosols, flammable liquids or gases (dangerous goods need an ADR service)", severity: "red" },
  { id: "R-07", name: "Gross weight", rule: "Total gross weight must be at least the sum of unit weight × quantity across all items", severity: "amber" },
  { id: "R-08", name: "Delivery slot", rule: "Shipments to a warehouse must have a delivery appointment booked", severity: "amber" },
  { id: "R-09", name: "Country of origin", rule: "Every item must have a country of origin", severity: "amber" },
  { id: "R-10", name: "Ship date", rule: "Ready to ship date must not be in the past", severity: "amber" },
  { id: "D-01", name: "Customs description", rule: "Product descriptions are specific enough for customs, and the invoice and packing list can be produced (advisory, never blocks)", severity: "amber", advisory: true },
];

export const RULE_NAMES: Record<string, string> = {
  ...Object.fromEntries(RULES.map((r) => [r.id, r.name])),
  DATA: "Missing details",
};
export const ruleName = (id: string) => RULE_NAMES[id] ?? id;

export const ORIGIN_CITIES = ["London", "Manchester", "Birmingham", "Leeds"];
export const DEST_CITIES: Record<string, string> = {
  Berlin: "Germany",
  Frankfurt: "Germany",
  Hamburg: "Germany",
  Paris: "France",
  Lyon: "France",
  Amsterdam: "Netherlands",
  Rotterdam: "Netherlands",
};
export const DEST_COUNTRIES = ["Germany", "France", "Netherlands"];
export const ORIGIN_COUNTRIES_OF_GOODS = ["United Kingdom", "China", "India", "Vietnam", "Turkey", "Germany"];
export const PRIORITIES: Priority[] = ["Cheapest", "Fastest", "Most reliable", "Balanced"];

export const INCOTERMS: Record<Incoterm, { name: string; who: string }> = {
  DAP: { name: "Delivered at Place", who: "The receiver clears EU import and pays duty and VAT." },
  DDP: { name: "Delivered Duty Paid", who: "You (the seller) clear EU import and pay duty and VAT." },
};

/** The Incoterm in force: the seller's choice, or a default from the site type (marked as assumed). */
export function effectiveIncoterm(b: Pick<Booking, "incoterm" | "destType">): { term: Incoterm; assumed: boolean } {
  if (b.incoterm) return { term: b.incoterm, assumed: false };
  // Marketplace and fulfilment warehouses usually expect the seller to be the importer.
  return { term: b.destType === "Warehouse" ? "DDP" : "DAP", assumed: true };
}

// Balanced model - our stated assumptions (slide 4).
export const MODEL = {
  /** Cost of goods sitting in transit, per day, as a share of goods value. */
  holdingRatePerDay: 0.001,
  /** Cost of a late arrival when a warehouse slot is booked (missed slot, rebooking). */
  latePenaltyWithSlot: 150,
  /** Cost of a late arrival otherwise. */
  latePenaltyNoSlot: 50,
  /** Packaging estimate used when suggesting a gross weight. */
  kgPerCarton: 0.5,
  kgPerPallet: 25,
  /** Declared value tolerance. */
  valueTolerance: 0.01,
};
