// Booked shipments (saved in this browser) and the dashboard's view of everything checked.
import { collectionDate } from "./carriers";
import { compareIso, formatDateLong } from "./dates";
import { neededFromYou } from "./confirm";
import { ruleName } from "./reference";
import type { Analysis, Booking } from "./types";

export interface Shipment {
  ref: string;
  bookedAt: string; // ISO date
  source: "chat" | "file";
  fileName?: string;
  booking: Booking;
  carrier: { carrier: string; service: string; freight: number; transitDays: number; onTimeRate: number; eta: string };
  collection: string;
  /** Warnings the seller accepted when booking. */
  acceptedWarnings: string[];
  /** Status changes the seller recorded by hand (forward only), oldest first. */
  events?: ShipmentEvent[];
}

export interface ShipmentEvent {
  type: "collected" | "delivered" | "cancelled";
  at: string; // ISO date the seller says it happened
  recordedAt: string; // ISO date it was entered
  note?: string;
}

export type Stage = "awaiting" | "transit" | "delivered" | "cancelled";

const KEY = "shipcheck.shipments";
export function loadShipments(): Shipment[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
export function saveShipments(s: Shipment[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: kept for this visit only */
  }
}

export function toShipment(a: Analysis, ref: string, today: string, source: Shipment["source"], fileName?: string): Shipment {
  const c = a.recommendation.chosen!;
  return {
    ref,
    bookedAt: today,
    source,
    fileName,
    booking: a.booking,
    carrier: { carrier: c.option.carrier, service: c.option.service, freight: c.freight, transitDays: c.option.transitDays, onTimeRate: c.option.onTimeRate, eta: c.eta! },
    collection: collectionDate(a.booking, today),
    acceptedWarnings: [...new Set(a.issues.filter((i) => i.severity === "amber").map((i) => ruleName(i.rule)))],
  };
}

const lastEvent = (s: Shipment, t: ShipmentEvent["type"]) => [...(s.events ?? [])].reverse().find((e) => e.type === t);

/**
 * Where a booked shipment is. Seller-recorded events win; otherwise it's estimated from the
 * collection and delivery dates (there's no live carrier feed).
 */
export function statusOf(s: Shipment, today: string): { stage: Stage; confirmed: boolean; label: string; event?: ShipmentEvent } {
  const cancelled = lastEvent(s, "cancelled");
  if (cancelled) return { stage: "cancelled", confirmed: true, label: "Cancelled", event: cancelled };
  const delivered = lastEvent(s, "delivered");
  if (delivered) return { stage: "delivered", confirmed: true, label: "Delivered", event: delivered };
  const collected = lastEvent(s, "collected");
  if (!collected && compareIso(today, s.collection) < 0) return { stage: "awaiting", confirmed: false, label: "Awaiting collection" };
  if (compareIso(today, s.carrier.eta) < 0)
    return collected ? { stage: "transit", confirmed: true, label: "In transit", event: collected } : { stage: "transit", confirmed: false, label: "In transit (est.)" };
  return { stage: "delivered", confirmed: false, label: "Delivered (est.)", event: collected };
}

export function stageOf(s: Shipment, today: string): Stage {
  return statusOf(s, today).stage;
}

/** Which manual changes are allowed now. Forward only; nothing after delivered or cancelled. */
export function allowedEvents(s: Shipment, today: string): ShipmentEvent["type"][] {
  const st = statusOf(s, today);
  if (st.stage === "cancelled" || (st.stage === "delivered" && st.confirmed)) return [];
  const collected = !!lastEvent(s, "collected");
  return collected ? ["delivered", "cancelled"] : ["collected", "cancelled"];
}

export function pendingDocs(s: Shipment) {
  return neededFromYou(s.booking).filter((d) => !d.done);
}

const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export interface ActionItem {
  key: string;
  urgency: number; // lower = sooner
  tone: "red" | "amber" | "indigo";
  title: string;
  detail: string;
  cta: string;
  target: { kind: "shipment"; ref: string } | { kind: "file"; id: string } | { kind: "chat" };
}

export function actionItems(shipments: Shipment[], checked: Analysis[], draft: Analysis | null, today: string): ActionItem[] {
  const out: ActionItem[] = [];
  for (const s of shipments) {
    const st = statusOf(s, today);
    // Dates have passed but nobody confirmed what happened.
    if (st.stage !== "cancelled" && !lastEvent(s, "collected") && !lastEvent(s, "delivered") && compareIso(today, s.collection) >= 0)
      out.push({ key: `${s.ref}-collected`, urgency: -1, tone: "amber", title: `${s.ref}: was it collected?`, detail: `Collection was due ${formatDateLong(s.collection)}. Confirm it, or cancel if it didn't go.`, cta: "Update status", target: { kind: "shipment", ref: s.ref } });
    else if (st.stage === "delivered" && !st.confirmed)
      out.push({ key: `${s.ref}-delivered`, urgency: -0.5, tone: "amber", title: `${s.ref}: was it delivered?`, detail: `Delivery was due ${formatDateLong(s.carrier.eta)}. Confirm it once the receiver has it.`, cta: "Update status", target: { kind: "shipment", ref: s.ref } });
    if (st.stage !== "awaiting") continue;
    const days = daysBetween(today, s.collection);
    const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const docs = pendingDocs(s);
    if (docs.length)
      out.push({ key: `${s.ref}-docs`, urgency: days, tone: days <= 2 ? "red" : "amber", title: `${s.ref}: ${docs.length} detail${docs.length > 1 ? "s" : ""} needed before collection`, detail: `${docs.map((d) => d.name).join(", ")}. Collection ${when} (${formatDateLong(s.collection)}).`, cta: "Add details", target: { kind: "shipment", ref: s.ref } });
    if (s.booking.destType === "Warehouse" && !s.booking.appointment)
      out.push({ key: `${s.ref}-slot`, urgency: days + 0.5, tone: "amber", title: `${s.ref}: book a delivery slot`, detail: `${s.booking.destCity} warehouse, for ${formatDateLong(s.carrier.eta)}.`, cta: "Mark as booked", target: { kind: "shipment", ref: s.ref } });
  }
  for (const a of checked) {
    const reds = a.issues.filter((i) => i.severity === "red");
    if (a.status === "blocked")
      out.push({ key: `${a.booking.id}-fix`, urgency: 50, tone: "red", title: `${a.booking.id} ${a.booking.sellerName}: ${reds.length || 1} issue${reds.length > 1 ? "s" : ""} to fix`, detail: reds.length ? [...new Set(reds.map((i) => ruleName(i.rule)))].join(", ") : a.recommendation.reason, cta: "Fix", target: { kind: "file", id: a.booking.id } });
    else if (a.status === "review")
      out.push({ key: `${a.booking.id}-review`, urgency: 60, tone: "amber", title: `${a.booking.id} ${a.booking.sellerName}: review ${a.counts.amber} warning${a.counts.amber > 1 ? "s" : ""}`, detail: [...new Set(a.issues.filter((i) => i.severity === "amber").map((i) => ruleName(i.rule)))].join(", "), cta: "Review", target: { kind: "file", id: a.booking.id } });
    else
      out.push({ key: `${a.booking.id}-book`, urgency: 70, tone: "indigo", title: `${a.booking.id} ${a.booking.sellerName}: ready to book`, detail: a.recommendation.chosen ? `${a.recommendation.chosen.option.carrier}, arrives ${formatDateLong(a.recommendation.chosen.eta)}` : "", cta: "Book", target: { kind: "file", id: a.booking.id } });
  }
  if (draft)
    out.push({ key: "draft", urgency: 40, tone: draft.status === "blocked" ? "amber" : "indigo", title: "Chat booking in progress", detail: `${draft.booking.originCity || "?"} → ${draft.booking.destCity || "?"} · ${draft.status === "ready" ? "ready to book" : "details or fixes still needed"}`, cta: "Continue", target: { kind: "chat" } });
  return out.sort((x, y) => x.urgency - y.urgency);
}
