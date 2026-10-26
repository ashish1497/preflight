// GET /api/tariff?code=69120023&origin=China&dest=Germany
// Official per-product customs data (UK Trade Tariff). Advisory; the app works without it.
import { ISO, lookupTariff } from "@/lib/tariff";

export const maxDuration = 30;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const code = q.get("code") ?? "";
  const origin = q.get("origin") ?? "";
  const dest = q.get("dest") ?? "";
  if (!/^\d{7,8}$/.test(code) || (origin && !ISO[origin]) || (dest && !ISO[dest]))
    return Response.json({ error: "bad_request" }, { status: 400 });
  const result = await lookupTariff(code, origin, dest).catch(() => null);
  if (!result) return Response.json({ error: "unavailable" }, { status: 502 });
  // Tariff data changes rarely: let the CDN cache it for a day.
  return Response.json(result, { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
