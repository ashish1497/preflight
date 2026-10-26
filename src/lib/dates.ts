// Dates are handled as ISO "yyyy-mm-dd" strings to avoid timezone drift.

const pad = (n: number) => String(n).padStart(2, "0");

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(): string {
  return toIso(new Date());
}

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Accepts "DD-MM-YYYY" (also / or .), "YYYY-MM-DD", Date objects and Excel serial numbers. */
export function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return toIso(raw);
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    // Excel serial: days since 1899-12-30.
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  return null;
}

/** "2026-11-05" → "05-11-2026" (the format sellers use). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  return fromIso(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** Road transit is quoted in working days: skip Saturdays and Sundays. */
export function addBusinessDays(iso: string, days: number): string {
  const d = fromIso(iso);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return toIso(d);
}

export function nextBusinessDay(iso: string): string {
  return addBusinessDays(iso, 1);
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
