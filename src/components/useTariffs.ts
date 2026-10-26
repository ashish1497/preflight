"use client";
// Official per-product tariff data for a booking's items, from /api/tariff (UK Trade Tariff).
// Shared by the customs card and the compliance checklist: one request per code + origin + destination.
import { useEffect, useState } from "react";
import { describeHs, type HsLookup } from "@/lib/hs";
import type { TariffByItem } from "@/lib/compliance";
import type { TariffResult } from "@/lib/tariff";
import type { Booking } from "@/lib/types";

const memo = new Map<string, Promise<TariffResult | null>>();
function fetchTariff(code: string, origin: string, dest: string) {
  const k = keyOf(code, origin, dest);
  if (!memo.has(k))
    memo.set(
      k,
      fetch(`/api/tariff?code=${code}&origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((d) => {
          if (!d) memo.delete(k); // retry next time
          return d;
        }),
    );
  return memo.get(k)!;
}

const keyOf = (code: string, origin: string, dest: string) => `${code}|${origin}|${dest}`;

/** Key for an item when it can be looked up (exact listed HS code, origin and destination), else null. */
function itemKey(b: Booking, i: number, hs: HsLookup | null): string | null {
  const it = b.items[i];
  return it?.hsCode && it.countryOfOrigin && b.destCountry && describeHs(it.hsCode, hs).exact ? keyOf(it.hsCode, it.countryOfOrigin, b.destCountry) : null;
}

/** Tariff data per item index: a result, "loading", "error", or undefined when the item can't be looked up yet. */
export function useTariffs(b: Booking, hs: HsLookup | null): TariffByItem {
  const [map, setMap] = useState<Record<string, TariffResult | "error">>({});
  const keys = b.items.map((_, i) => itemKey(b, i, hs));
  const sig = [...new Set(keys.filter(Boolean))].join(",");
  useEffect(() => {
    if (!sig) return;
    for (const k of sig.split(",")) {
      const [code, origin, dest] = k.split("|");
      fetchTariff(code, origin, dest).then((d) => setMap((m) => ({ ...m, [k]: d ?? "error" })));
    }
  }, [sig]);
  const out: TariffByItem = {};
  keys.forEach((k, i) => {
    out[i] = k ? (map[k] ?? "loading") : undefined;
  });
  return out;
}
