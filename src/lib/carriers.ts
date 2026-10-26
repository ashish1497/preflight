import { CARRIERS, MODEL } from "./reference";
import { addBusinessDays, compareIso, formatDate, nextBusinessDay } from "./dates";
import type { Booking, CarrierEval, Priority, Recommendation } from "./types";

export const gbp = (n: number) =>
  "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const name = (e: CarrierEval) => `${e.option.carrier} (${e.option.service})`;

/** Collection date used for ETAs: the ready date, or the next working day if it has passed. */
export function collectionDate(b: Booking, today: string): string {
  if (b.readyDate && compareIso(b.readyDate, today) >= 0) return b.readyDate;
  return nextBusinessDay(today);
}

export function evaluateCarriers(b: Booking, today: string): CarrierEval[] {
  const pallets = b.pallets && b.pallets > 0 ? b.pallets : null;
  const wpp = pallets && b.grossWeight != null ? b.grossWeight / pallets : null;
  const value = b.declaredValue ?? 0;
  const penalty = b.destType === "Warehouse" && b.appointment ? MODEL.latePenaltyWithSlot : MODEL.latePenaltyNoSlot;
  const start = collectionDate(b, today);

  return CARRIERS.filter((c) => c.destCountry === b.destCountry).map((option) => {
    const freight = option.pricePerPallet * (pallets ?? 0);
    const timeCost = value * MODEL.holdingRatePerDay * option.transitDays;
    const lateRisk = (1 - option.onTimeRate / 100) * penalty;
    const eta = addBusinessDays(start, option.transitDays);
    const fitsWeight = wpp == null ? true : wpp <= option.maxWeightPerPallet;
    const meetsDeadline = !b.neededBy || compareIso(eta, b.neededBy) <= 0;
    let excludedReason: string | undefined;
    if (!fitsWeight)
      excludedReason = `${Math.round(wpp!)} kg per pallet is over its ${option.maxWeightPerPallet} kg limit`;
    else if (!meetsDeadline)
      excludedReason = `arrives ${formatDate(eta)}, after your needed-by date ${formatDate(b.neededBy)}`;
    return {
      option,
      freight,
      timeCost,
      lateRisk,
      effectiveCost: freight + timeCost + lateRisk,
      eta,
      fitsWeight,
      meetsDeadline,
      eligible: fitsWeight && meetsDeadline,
      excludedReason,
    };
  });
}

function rank(evals: CarrierEval[], priority: Priority): CarrierEval[] {
  const by = (...keys: ((e: CarrierEval) => number)[]) =>
    [...evals].sort((a, b) => {
      for (const k of keys) {
        const d = k(a) - k(b);
        if (Math.abs(d) > 1e-9) return d;
      }
      return 0;
    });
  switch (priority) {
    case "Cheapest":
      return by((e) => e.freight, (e) => -e.option.onTimeRate);
    case "Fastest":
      return by((e) => e.option.transitDays, (e) => -e.option.onTimeRate, (e) => e.freight);
    case "Most reliable":
      return by((e) => -e.option.onTimeRate, (e) => e.freight);
    case "Balanced":
      return by((e) => e.effectiveCost, (e) => e.freight);
  }
}

function reasonFor(p: Priority, c: CarrierEval, b: Booking): string {
  const o = c.option;
  switch (p) {
    case "Cheapest":
      return `You asked for the cheapest option. ${name(c)} is the lowest price that can take your pallets: ${gbp(o.pricePerPallet)} × ${b.pallets} pallets = ${gbp(c.freight)}.`;
    case "Fastest":
      return `You asked for the fastest option. ${name(c)} is the quickest service that can take your pallets: ${o.transitDays} working days, arriving ${formatDate(c.eta)}.`;
    case "Most reliable":
      return `You asked for the most reliable option. ${name(c)} has the highest on-time rate among services that can take your pallets: ${o.onTimeRate}% arrive on the promised day.`;
    case "Balanced":
      return `You asked for the best balance. ${name(c)} has the lowest total cost once time and late-delivery risk are priced in: ${gbp(c.freight)} freight + ${gbp(c.timeCost)} for ${o.transitDays} days of stock in transit + ${gbp(c.lateRisk)} late-delivery risk = ${gbp(c.effectiveCost)}.`;
  }
}

function tradeOff(chosen: CarrierEval, other: CarrierEval): string {
  const parts: string[] = [];
  const dPrice = other.freight - chosen.freight;
  const dDays = other.option.transitDays - chosen.option.transitDays;
  const dRel = other.option.onTimeRate - chosen.option.onTimeRate;
  if (dPrice) parts.push(`${gbp(Math.abs(dPrice))} ${dPrice > 0 ? "more" : "cheaper"}`);
  if (dDays) parts.push(`${Math.abs(dDays)} day${Math.abs(dDays) > 1 ? "s" : ""} ${dDays > 0 ? "slower" : "faster"}`);
  if (dRel) parts.push(`${Math.abs(dRel)} pts ${dRel > 0 ? "more" : "less"} reliable`);
  return `${name(other)} is ${parts.join(", ") || "the same on price, speed and reliability"}.`;
}

export function recommend(b: Booking, today: string): Recommendation {
  const evals = evaluateCarriers(b, today);
  const notes: string[] = [];
  const priority: Priority = b.priority ?? "Balanced";
  if (!b.priority) notes.push("No seller priority given, so we used Balanced.");
  if (!evals.length)
    return { chosen: null, evals, reason: "No carrier runs to this destination. Check the destination country.", notes };
  if (!b.pallets || b.pallets <= 0)
    return { chosen: null, evals, reason: "We need the number of pallets before we can price and pick a carrier.", notes };

  const ideal = rank(evals, priority)[0];
  const eligible = rank(evals.filter((e) => e.eligible), priority);
  const chosen = eligible[0] ?? null;

  for (const e of evals) if (!e.eligible) notes.push(`${name(e)} ruled out: ${e.excludedReason}.`);

  if (!chosen) {
    const anyFits = evals.some((e) => e.fitsWeight);
    return {
      chosen: null,
      evals,
      reason: anyFits
        ? "No carrier can deliver by your needed-by date. Move the date or the ready date."
        : "No carrier can take pallets this heavy. Spread the load over more pallets (see Pallet weight).",
      notes,
    };
  }

  // The seller's ideal carrier was ruled out by weight: show what it would take.
  if (ideal !== chosen && !ideal.fitsWeight && b.grossWeight != null) {
    const need = Math.ceil(b.grossWeight / ideal.option.maxWeightPerPallet);
    const cost = need * ideal.option.pricePerPallet;
    notes.push(
      `Your ${priority.toLowerCase()} pick would be ${name(ideal)}, but its pallet limit is ${ideal.option.maxWeightPerPallet} kg. ` +
        `Re-packing onto ${need} pallets would make it possible for ${gbp(cost)} (vs ${gbp(chosen.freight)} now).`,
    );
  }

  const runner = eligible[1];
  return {
    chosen,
    evals,
    reason: reasonFor(priority, chosen, b),
    notes,
    runnerUp: runner ? { eval: runner, tradeOff: tradeOff(chosen, runner) } : undefined,
  };
}
