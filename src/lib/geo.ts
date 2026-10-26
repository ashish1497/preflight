// City coordinates for the allowed routes, and an indicative road path via the Dover–Calais crossing.
export type LatLng = [number, number];

export const CITY_COORDS: Record<string, LatLng> = {
  London: [51.5072, -0.1276],
  Manchester: [53.4808, -2.2426],
  Birmingham: [52.4862, -1.8904],
  Leeds: [53.8008, -1.5491],
  Berlin: [52.52, 13.405],
  Frankfurt: [50.1109, 8.6821],
  Hamburg: [53.5511, 9.9937],
  Paris: [48.8566, 2.3522],
  Lyon: [45.764, 4.8357],
  Amsterdam: [52.3676, 4.9041],
  Rotterdam: [51.9244, 4.4777],
};

/** Short uppercase codes for map labels and lane lists (IATA-style city codes). */
export const CITY_CODE: Record<string, string> = {
  London: "LON",
  Manchester: "MAN",
  Birmingham: "BHX",
  Leeds: "LBA",
  Berlin: "BER",
  Frankfurt: "FRA",
  Hamburg: "HAM",
  Paris: "PAR",
  Lyon: "LYS",
  Amsterdam: "AMS",
  Rotterdam: "RTM",
};
export function cityCode(city: string | null | undefined): string {
  if (!city) return "—";
  return CITY_CODE[city] ?? city.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

const DOVER: LatLng = [51.1279, 1.3134];
const CALAIS: LatLng = [50.9513, 1.8587];

/** Point on a Catmull-Rom spline between p1 and p2 (p0, p3 are the neighbours). */
function catmull(p0: LatLng, p1: LatLng, p2: LatLng, p3: LatLng, t: number): LatLng {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** Smooth curve through every waypoint. */
function smooth(points: LatLng[], steps = 12): LatLng[] {
  const pts = [points[0], ...points, points[points.length - 1]];
  const out: LatLng[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    for (let s = 0; s < steps; s++) out.push(catmull(pts[i - 1], pts[i], pts[i + 1], pts[i + 2], s / steps));
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Midpoint of a→b pushed sideways by a share of the distance, so legs read as gentle arcs. */
function bow(a: LatLng, b: LatLng, k: number): LatLng {
  const dLat = b[0] - a[0], dLon = b[1] - a[1];
  return [(a[0] + b[0]) / 2 + dLon * k, (a[1] + b[1]) / 2 - dLat * k];
}

/** Indicative road path: origin → Dover, across to Calais, → destination, as one smooth arc. */
export function routePath(origin: string, dest: string): LatLng[] | null {
  const o = CITY_COORDS[origin], d = CITY_COORDS[dest];
  if (!o || !d) return null;
  return smooth([o, bow(o, DOVER, 0.06), DOVER, CALAIS, bow(CALAIS, d, -0.06), d]);
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Indicative road distance: path length × 1.15 for roads not being straight. */
export function roadKm(origin: string, dest: string): number | null {
  const p = routePath(origin, dest);
  if (!p) return null;
  let km = 0;
  for (let i = 1; i < p.length; i++) km += haversineKm(p[i - 1], p[i]);
  return Math.round((km * 1.15) / 10) * 10;
}
