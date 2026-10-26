import { recommend } from "./carriers";
import { checkBooking, sumItems } from "./rules";
import type { HsLookup } from "./hs";
import type { Analysis, Booking, Patch } from "./types";

export function analyze(booking: Booking, today: string, hs: HsLookup | null): Analysis {
  const issues = checkBooking(booking, today, hs);
  const counts = { red: 0, amber: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const s = sumItems(booking);
  const recommendation = recommend(booking, today);
  return {
    booking,
    issues,
    recommendation,
    // No carrier means nothing can be booked, even if no rule fired.
    status: counts.red || !recommendation.chosen ? "blocked" : counts.amber ? "review" : "ready",
    counts,
    computed: {
      itemsValue: s.value,
      itemsCartons: s.cartons,
      netWeight: s.net,
      weightPerPallet: booking.pallets && booking.grossWeight != null ? booking.grossWeight / booking.pallets : null,
    },
  };
}

export function applyPatches(b: Booking, patches: Patch[]): Booking {
  const next: Booking = { ...b, items: b.items.map((it) => ({ ...it })) };
  for (const p of patches) {
    if (p.kind === "booking") (next as unknown as Record<string, unknown>)[p.field] = p.value;
    else if (next.items[p.index]) {
      (next.items[p.index] as unknown as Record<string, unknown>)[p.field] = p.value;
      if (p.field === "hsCode") next.items[p.index].hsSuggested = false;
    }
  }
  return next;
}
