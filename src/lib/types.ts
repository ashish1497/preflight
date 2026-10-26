export type Priority = "Cheapest" | "Fastest" | "Most reliable" | "Balanced";
export type DestType = "Warehouse" | "Business address";
export type Severity = "red" | "amber" | "info";
/** Who pays EU import duty/VAT: DAP = receiver, DDP = seller. Preflight always books freight to the destination. */
export type Incoterm = "DAP" | "DDP";

export interface Item {
  sku: string;
  description: string;
  /** Digits only, as the seller gave them (leading zeros may be lost). null = blank. */
  hsCode: string | null;
  /** True when the HS code was suggested by the assistant, not typed by the seller. */
  hsSuggested?: boolean;
  quantity: number | null;
  unitPrice: number | null;
  unitsPerCarton: number | null;
  cartons: number | null;
  unitWeight: number | null;
  countryOfOrigin: string | null;
}

export interface Booking {
  id: string;
  sellerName: string;
  originCity: string;
  originCountry: string;
  destCity: string;
  destCountry: string;
  destType: DestType | null;
  /** ISO yyyy-mm-dd, or null when blank / unreadable. */
  readyDate: string | null;
  priority: Priority | null;
  pallets: number | null;
  cartons: number | null;
  declaredValue: number | null;
  currency: string;
  grossWeight: number | null;
  appointment: boolean | null;
  items: Item[];
  /** Chat only: latest acceptable delivery date (ISO). */
  neededBy?: string | null;
  exporterEori?: string | null;
  consigneeName?: string | null;
  consigneeAddress?: string | null;
  /** Receiver's EU EORI or VAT number. */
  consigneeEori?: string | null;
  incoterm?: Incoterm | null;
  /** Seller's EU EORI, needed when the seller is the importer (DDP). */
  sellerEuEori?: string | null;
  /** Compliance tasks the seller has confirmed (e.g. an exemption), keyed by checklist item id. */
  confirmations?: Record<string, boolean>;
}

/** A change the seller can accept with one click. */
export type Patch =
  | { kind: "booking"; field: keyof Booking; value: unknown }
  | { kind: "item"; index: number; field: keyof Item; value: unknown };

export interface QuickFix {
  label: string;
  patches: Patch[];
}

export interface Issue {
  rule: string; // R-01..R-10, D-01, DATA
  severity: Severity;
  title: string;
  /** What is wrong, with the numbers. */
  detail: string;
  /** How to fix it, in plain words. */
  fix: string;
  itemIndex?: number;
  quickFixes?: QuickFix[];
}

export interface CarrierOption {
  carrier: string;
  service: string;
  destCountry: string;
  pricePerPallet: number;
  transitDays: number;
  onTimeRate: number;
  maxWeightPerPallet: number;
}

export interface CarrierEval {
  option: CarrierOption;
  freight: number;
  timeCost: number;
  lateRisk: number;
  effectiveCost: number;
  eta: string | null;
  fitsWeight: boolean;
  meetsDeadline: boolean;
  eligible: boolean;
  excludedReason?: string;
}

export interface Recommendation {
  chosen: CarrierEval | null;
  evals: CarrierEval[];
  reason: string;
  notes: string[];
  runnerUp?: { eval: CarrierEval; tradeOff: string };
}

export type Status = "blocked" | "review" | "ready";

export interface Analysis {
  booking: Booking;
  issues: Issue[];
  recommendation: Recommendation;
  status: Status;
  counts: { red: number; amber: number; info: number };
  computed: {
    itemsValue: number;
    itemsCartons: number;
    netWeight: number;
    weightPerPallet: number | null;
  };
}

/** Result of a bookings file dropped into chat (shown as a summary card). */
export interface FileSummary {
  fileName: string;
  total: number;
  ready: number;
  review: number;
  blocked: number;
  /** Up to 3 bookings that need attention, with their main issue (check name). */
  top: { id: string; seller: string; issue: string }[];
}
