import * as XLSX from "xlsx";
import { parseDate } from "./dates";
import { normalizeHs } from "./hs";
import { DEST_CITIES, PRIORITIES } from "./reference";
import type { Booking, DestType, Item, Priority } from "./types";

export interface ParseResult {
  bookings: Booking[];
  warnings: string[];
}

type Row = Record<string, unknown>;

const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The example row shipped in the booking template. Skipped only if it's an exact copy. */
const EXAMPLE_BOOKING = ["BK-001", "Northfield Goods", "Manchester", "Frankfurt", 620];
const EXAMPLE_ITEM = ["BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", 1080];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[£,\s]/g, ""));
  return isFinite(n) ? n : null;
}
function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}
function title(v: unknown): string {
  const s = str(v).toLowerCase();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Find the header row by looking for "Booking ID", then read rows below it as objects keyed by normalised header. */
function readSheet(ws: XLSX.WorkSheet): Row[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const h = grid.findIndex((r) => r.some((c) => key(c) === "bookingid"));
  if (h < 0) return [];
  const headers = grid[h].map(key);
  return grid
    .slice(h + 1)
    .filter((r) => r.some((c) => c !== null && str(c) !== ""))
    .map((r) => Object.fromEntries(headers.map((k, i) => [k, r[i]])));
}

function findSheet(wb: XLSX.WorkBook, want: string, mustHave: string): XLSX.WorkSheet | null {
  const byName = wb.SheetNames.find((n) => key(n).includes(want));
  if (byName) return wb.Sheets[byName];
  // Fall back to any sheet whose header row has the column we expect.
  for (const n of wb.SheetNames) {
    const rows = readSheet(wb.Sheets[n]);
    if (rows.length && mustHave in rows[0]) return wb.Sheets[n];
  }
  return null;
}

function isExample(values: unknown[], example: unknown[]) {
  return values.every((v, i) => str(v) === str(example[i]));
}

function priority(v: unknown): Priority | null {
  const s = key(v);
  return PRIORITIES.find((p) => key(p) === s) ?? null;
}
function destType(v: unknown): DestType | null {
  const s = key(v);
  if (s.startsWith("ware")) return "Warehouse";
  if (s.startsWith("bus")) return "Business address";
  return null;
}
function yesNo(v: unknown): boolean | null {
  const s = key(v);
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
}

export function parseWorkbook(data: ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const warnings: string[] = [];
  const bSheet = findSheet(wb, "booking", "totalgrossweightkg");
  const iSheet = findSheet(wb, "item", "sku");
  if (!bSheet) return { bookings: [], warnings: ["Couldn't find a Bookings sheet with a \"Booking ID\" header."] };
  if (!iSheet) warnings.push("Couldn't find an Items sheet - bookings are checked without items.");

  let bRows = readSheet(bSheet);
  let iRows = iSheet ? readSheet(iSheet) : [];

  // Skip the template's example row if it was left in unchanged, unless it's the only data.
  const exB = bRows.filter((r) => isExample([r.bookingid, r.sellername, r.origincity, r.destinationcity, r.totalgrossweightkg], EXAMPLE_BOOKING));
  if (exB.length && bRows.length > exB.length) {
    const realHasBk001 = bRows.some((r) => str(r.bookingid) === "BK-001" && !exB.includes(r));
    bRows = bRows.filter((r) => !exB.includes(r));
    iRows = iRows.filter((r) => !isExample([r.bookingid, r.sku, r.description, r.quantityunits], EXAMPLE_ITEM) || realHasBk001);
    warnings.push("Skipped the example row from the template (BK-001, Northfield Goods).");
  }

  const items = new Map<string, Item[]>();
  for (const r of iRows) {
    const id = str(r.bookingid);
    if (!id) continue;
    const it: Item = {
      sku: str(r.sku),
      description: str(r.description),
      hsCode: normalizeHs(r.hscode),
      quantity: num(r.quantityunits ?? r.quantity),
      unitPrice: num(r.unitprice),
      unitsPerCarton: num(r.unitspercarton),
      cartons: num(r.cartons),
      unitWeight: num(r.unitweightkg ?? r.unitweight),
      countryOfOrigin: str(r.countryoforigin) ? title(r.countryoforigin) : null,
    };
    if (!items.has(id)) items.set(id, []);
    items.get(id)!.push(it);
  }

  const seen = new Set<string>();
  const bookings: Booking[] = [];
  for (const r of bRows) {
    let id = str(r.bookingid);
    if (!id) continue;
    if (seen.has(id)) {
      warnings.push(`Booking ID ${id} appears more than once - showing each separately.`);
      id = `${id} (#${bookings.filter((b) => b.id.startsWith(id)).length + 1})`;
    }
    seen.add(str(r.bookingid));
    const destCity = title(r.destinationcity);
    const readyRaw = r.readytoshipdate;
    const readyDate = parseDate(readyRaw);
    if (readyRaw && !readyDate) warnings.push(`${id}: couldn't read ready date "${str(readyRaw)}".`);
    bookings.push({
      id,
      sellerName: str(r.sellername),
      originCity: title(r.origincity),
      originCountry: title(r.origincountry) || "United Kingdom",
      destCity,
      destCountry: title(r.destinationcountry) || DEST_CITIES[destCity] || "",
      destType: destType(r.destinationtype),
      readyDate,
      priority: priority(r.sellerpriority),
      pallets: num(r.pallets),
      cartons: num(r.cartons),
      declaredValue: num(r.totaldeclaredvalue),
      currency: str(r.currency) || "GBP",
      grossWeight: num(r.totalgrossweightkg),
      appointment: yesNo(r.deliveryappointmentbooked),
      items: items.get(str(r.bookingid)) ?? [],
    });
  }

  for (const id of items.keys())
    if (!seen.has(id)) warnings.push(`Items for ${id} have no matching row on the Bookings sheet - ignored.`);

  return { bookings, warnings };
}
