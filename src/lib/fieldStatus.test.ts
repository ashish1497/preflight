import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "./parse";
import { analyze, applyPatches } from "./analyze";
import { fieldIssues, itemKey, messageFor, meter, sectionStatus, stateFor } from "./fieldStatus";
import type { HsLookup } from "./hs";
import type { Booking } from "./types";

const TODAY = "2026-10-26";
const hs = JSON.parse(readFileSync("public/data/hs.json", "utf8")) as HsLookup;
const buf = readFileSync("public/sample/ShipCheck_sample_bookings.xlsx");
const parsed = parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const byId = Object.fromEntries(parsed.bookings.map((b) => [b.id, analyze(b, TODAY, hs)]));

describe("meter", () => {
  it("clean bookings pass all 11 checks", () => {
    for (const id of ["BK-101", "BK-107", "BK-108"]) expect(meter(byId[id]), id).toMatchObject({ passed: 11, total: 11, failing: [] });
  });
  it("counts each failing check once", () => {
    expect(meter(byId["BK-102"]).failing).toEqual(["R-03", "R-04"]);
    expect(meter(byId["BK-104"]).failing).toEqual(["R-01", "R-09"]); // two R-01 issues, one check
    expect(meter(byId["BK-106"]).failing).toEqual(["R-07", "R-08", "R-10"]);
    expect(meter(byId["BK-109"])).toMatchObject({ passed: 10, failing: ["D-01"] });
  });
  it("ignores info notes (partial tariff code)", () => {
    expect(byId["BK-105"].issues.some((i) => i.severity === "info" && i.rule === "R-01")).toBe(true);
    expect(meter(byId["BK-105"]).failing).not.toContain("R-01");
  });
  it("a check can't pass while the data it needs is missing", () => {
    const b: Booking = { ...byId["BK-101"].booking, declaredValue: null };
    const m = meter(analyze(b, TODAY, hs));
    expect(m.failing).toContain("R-02");
    expect(m.passed).toBeLessThan(11);
  });
  it("an empty booking passes almost nothing", () => {
    const empty: Booking = { ...byId["BK-101"].booking, items: [], pallets: null, cartons: null, declaredValue: null, grossWeight: null, readyDate: null };
    expect(meter(analyze(empty, TODAY, hs)).passed).toBeLessThanOrEqual(2);
  });
});

describe("field states", () => {
  it("wrong declared value is red on the field and in the Load section; fixing it updates", () => {
    const a = byId["BK-105"];
    expect(stateFor("declaredValue", a.booking.declaredValue, a)).toBe("error");
    expect(messageFor("declaredValue", a, "error")?.rule).toBe("R-02");
    expect(sectionStatus(a, "load").red.map((i) => i.rule)).toEqual(["R-02"]);
    expect(meter(a).failing).toContain("R-02");

    const fix = a.issues.find((i) => i.rule === "R-02")!.quickFixes![0];
    const fixed = analyze(applyPatches(a.booking, fix.patches), TODAY, hs);
    expect(stateFor("declaredValue", fixed.booking.declaredValue, fixed)).toBe("verified");
    expect(sectionStatus(fixed, "load").red).toEqual([]);
    expect(meter(fixed).passed).toBe(meter(a).passed + 1);
  });
  it("maps item issues to the item's fields", () => {
    const a = byId["BK-104"];
    expect(stateFor(itemKey(0, "hsCode"), a.booking.items[0].hsCode, a)).toBe("error");
    expect(stateFor(itemKey(1, "countryOfOrigin"), null, a)).toBe("warning");
    expect(sectionStatus(a, "goods").red.length).toBe(2);
    const b = byId["BK-102"];
    const r03 = b.issues.find((i) => i.rule === "R-03")!;
    for (const f of ["unitsPerCarton", "cartons", "quantity"] as const) expect(fieldIssues(b).get(itemKey(r03.itemIndex!, f))).toContain(r03);
    expect(stateFor("cartons", b.booking.cartons, b)).toBe("error"); // R-04
  });
  it("amber checks show as warnings in the Dates section", () => {
    const a = byId["BK-106"];
    expect(stateFor("appointment", a.booking.appointment, a)).toBe("warning");
    expect(stateFor("readyDate", a.booking.readyDate, a)).toBe("warning");
    expect(stateFor("grossWeight", a.booking.grossWeight, a)).toBe("warning");
    expect(sectionStatus(a, "dates").amber.map((i) => i.rule).sort()).toEqual(["R-08", "R-10"]);
  });
  it("vague description warns on the description field", () => {
    const a = byId["BK-109"];
    const i = a.issues.find((x) => x.rule === "D-01")!.itemIndex!;
    expect(stateFor(itemKey(i, "description"), a.booking.items[i].description, a)).toBe("warning");
  });
  it("blank required fields are missing, not errors; optional ones stay plain", () => {
    const a = analyze({ ...byId["BK-101"].booking, declaredValue: null, pallets: null }, TODAY, hs);
    expect(stateFor("declaredValue", null, a)).toBe("missing");
    expect(stateFor("pallets", null, a)).toBe("missing");
    expect(sectionStatus(a, "load")).toMatchObject({ red: [], missing: expect.arrayContaining(["declaredValue", "pallets"]) });
    // A filled but invalid value (0 pallets) is still something to fix.
    const zero = analyze({ ...byId["BK-101"].booking, pallets: 0 }, TODAY, hs);
    expect(stateFor("pallets", 0, zero)).toBe("error");
    expect(sectionStatus(zero, "load").red.map((i) => i.rule)).toContain("DATA");
    expect(stateFor("neededBy", null, a)).toBe("plain");
  });
  it("suggested and verified", () => {
    const a = byId["BK-101"];
    expect(stateFor("cartons", a.booking.cartons, a, { suggested: true })).toBe("suggested");
    expect(stateFor("cartons", a.booking.cartons, a)).toBe("verified");
    expect(stateFor("sellerName", a.booking.sellerName, a)).toBe("plain");
    expect(sectionStatus(a, "route")).toMatchObject({ red: [], amber: [], missing: [] });
  });
});
