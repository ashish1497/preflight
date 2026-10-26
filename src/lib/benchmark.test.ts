// Seeded-error benchmark. `npx vitest run src/lib/benchmark.test.ts` checks the numbers;
// with BENCH_WRITE=1 it also writes the report, a reviewer workbook and the answer key.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { generate, mistakeText, score } from "./benchmark";
import { analyze } from "./analyze";
import { parseWorkbook } from "./parse";
import type { HsLookup } from "./hs";

const TODAY = "2026-10-26";
const SETUP = { seed: 20261026, clean: 40, edge: 15, perMistake: 6, today: TODAY };
const hs = JSON.parse(readFileSync("public/data/hs.json", "utf8")) as HsLookup;
const data = generate(SETUP);
const report = score(data, hs, TODAY);

/** Reviewer workbook: same layout as the booking template, no hints about the mistakes. */
function workbook(): Buffer {
    const bookings = data.map(({ booking: b }) => ({
      "Booking ID": b.id, "Seller name": b.sellerName, "Origin city": b.originCity, "Origin country": b.originCountry,
      "Destination city": b.destCity, "Destination country": b.destCountry, "Destination type": b.destType,
      "Ready to ship date": b.readyDate ? b.readyDate.split("-").reverse().join("-") : "", "Seller priority": b.priority,
      Pallets: b.pallets, Cartons: b.cartons, "Total declared value": b.declaredValue, Currency: "GBP",
      "Total gross weight (kg)": b.grossWeight, "Delivery appointment booked": b.appointment ? "Yes" : "No",
    }));
    const items = data.flatMap(({ booking: b }) => b.items.map((i) => ({
      "Booking ID": b.id, SKU: i.sku, Description: i.description, "HS code": i.hsCode ?? "", "Quantity (units)": i.quantity,
      "Unit price": i.unitPrice, "Units per carton": i.unitsPerCarton, Cartons: i.cartons, "Unit weight (kg)": i.unitWeight, "Country of origin": i.countryOfOrigin ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Bookings (benchmark, " + data.length + " rows)"]]), "Bookings");
    XLSX.utils.sheet_add_json(wb.Sheets.Bookings, bookings, { origin: "A2" });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Items"]]), "Items");
    XLSX.utils.sheet_add_json(wb.Sheets.Items, items, { origin: "A2" });
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("seeded-error benchmark", () => {
  it("is reproducible", () => {
    expect(generate(SETUP).map((s) => s.booking.declaredValue)).toEqual(data.map((s) => s.booking.declaredValue));
  });

  it("generated correct bookings really are correct before mistakes are planted", () => {
    // Guard against a broken generator inflating the false-alarm rate.
    expect(report.correctBookings).toBe(SETUP.clean + SETUP.edge);
  });

  it("catches planted mistakes and doesn't flag correct bookings", () => {
    expect(report.recall).toBeGreaterThanOrEqual(0.95);
    expect(report.falseAlarmRate).toBeLessThanOrEqual(0.05);
  });

  it("gives the same result when the workbook goes through the real upload code", () => {
    const buf = workbook();
    const parsed = parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(parsed.bookings).toHaveLength(data.length);
    const fromFile = new Map(parsed.bookings.map((b) => [b.id, analyze(b, TODAY, hs)]));
    for (const s of data) {
      const want = new Set(analyze(s.booking, TODAY, hs).issues.filter((i) => i.severity !== "info").map((i) => i.rule));
      const got = new Set(fromFile.get(s.booking.id)!.issues.filter((i) => i.severity !== "info").map((i) => i.rule));
      expect([...got].sort(), s.booking.id).toEqual([...want].sort());
    }
  });

  it("writes the report when asked", () => {
    if (!process.env.BENCH_WRITE) return;
    mkdirSync("benchmark", { recursive: true });
    writeFileSync("src/data/benchmark-results.json", JSON.stringify({ ...report, setup: SETUP, runAt: new Date().toISOString().slice(0, 10) }, null, 2));

    writeFileSync("public/benchmark/ShipCheck_benchmark_bookings.xlsx", workbook());

    const key = ["Booking ID,Planted mistakes,Edge case (correct)", ...data.map((s) => `${s.booking.id},"${[...s.planted, ...(s.blind ? [s.blind] : [])].map((m) => `${m} ${mistakeText(m)}`).join("; ")}","${s.edgeCase ?? ""}"`)];
    writeFileSync("benchmark/answer_key.csv", key.join("\n"));
    writeFileSync("public/benchmark/answer_key.csv", key.join("\n"));
  });
});
