import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "./parse";
import { analyze, applyPatches } from "./analyze";
import type { HsLookup } from "./hs";

const TODAY = "2026-10-26";
const hs = JSON.parse(readFileSync("public/data/hs.json", "utf8")) as HsLookup;
const buf = readFileSync("public/sample/ShipCheck_sample_bookings.xlsx");
const parsed = parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const byId = Object.fromEntries(parsed.bookings.map((b) => [b.id, analyze(b, TODAY, hs)]));
const rules = (id: string, sev?: string) =>
  byId[id].issues.filter((i) => !sev || i.severity === sev).map((i) => i.rule).sort();

describe("parser", () => {
  it("skips the grey example row and reads 9 bookings", () => {
    expect(parsed.bookings.map((b) => b.id)).toEqual(["BK-101", "BK-102", "BK-103", "BK-104", "BK-105", "BK-106", "BK-107", "BK-108", "BK-109"]);
    expect(parsed.warnings.some((w) => w.includes("example"))).toBe(true);
  });
  it("reads text dates, numbers and blanks", () => {
    const b = byId["BK-104"].booking;
    expect(b.readyDate).toBe("2026-11-11");
    expect(b.items[0].hsCode).toBe("90121");
    expect(b.items[1].hsCode).toBeNull();
    expect(b.items[1].countryOfOrigin).toBeNull();
  });
});

describe("rulebook", () => {
  it("clean bookings pass", () => {
    for (const id of ["BK-101", "BK-107", "BK-108"]) expect(byId[id].status, id).toBe("ready");
  });
  it("R-03 + R-04", () => expect(rules("BK-102", "red")).toEqual(["R-03", "R-04"]));
  it("R-05 when no carrier can take the pallets", () => {
    expect(rules("BK-103", "red")).toEqual(["R-05"]);
    expect(byId["BK-103"].recommendation.chosen).toBeNull();
    const fix = byId["BK-103"].issues[0].quickFixes![0];
    const fixed = analyze(applyPatches(byId["BK-103"].booking, fix.patches), TODAY, hs);
    expect(fixed.booking.pallets).toBe(3);
    expect(fixed.recommendation.chosen?.option.carrier).toBe("Carrier B");
  });
  it("R-01 short code offers the listed tariff code; R-09 blank origin", () => {
    expect(rules("BK-104", "red")).toEqual(["R-01", "R-01"]);
    expect(rules("BK-104", "amber")).toEqual(["R-09"]);
    // "90121" is 5 digits; the tariff list writes roasted coffee as 9012100 (exactly as published).
    const short = byId["BK-104"].issues.find((i) => i.title.includes("only 5 digits"));
    expect(short?.quickFixes?.[0].label.startsWith("9012100")).toBe(true);
  });
  it("R-06 dangerous goods + R-02 value", () => {
    expect(rules("BK-105", "red")).toEqual(["R-02", "R-06", "R-06"]);
  });
  it("R-07, R-08, R-10 are amber", () => {
    expect(rules("BK-106", "amber")).toEqual(["R-07", "R-08", "R-10"]);
    expect(byId["BK-106"].status).toBe("review");
  });
  it("D-01 vague description is amber, never red", () => {
    expect(rules("BK-109", "amber")).toEqual(["D-01"]);
    expect(rules("BK-109", "red")).toEqual([]);
    expect(byId["BK-109"].status).toBe("review");
  });
});

describe("tariff list codes", () => {
  it("offers the listed code for a partial HS code, without changing status", () => {
    const cases = byId["BK-105"].issues.find((i) => i.title.includes("isn't a full code"));
    expect(cases?.severity).toBe("info");
    expect(cases?.quickFixes?.map((f) => f.label.slice(0, 8))).toEqual(["39269050", "39269060", "39269097"]);
    expect(byId["BK-101"].issues.filter((i) => i.rule === "R-01")).toEqual([]); // exact listed codes
  });
});

describe("exact tariff codes", () => {
  it("never pads codes: a 7-digit listed code is used as is", () => {
    expect(hs.codes["9012100"]).toBe("Roasted coffee (excl. decaffeinated)");
    expect(hs.codes["09012100"]).toBeUndefined();
  });
});

describe("carrier recommendation", () => {
  const pick = (id: string) => byId[id].recommendation.chosen?.option.carrier;
  it("example-style Cheapest -> A", () => expect(pick("BK-105")).toBe("Carrier A"));
  it("Fastest with 480 kg pallets -> B, explains C was ruled out", () => {
    expect(pick("BK-107")).toBe("Carrier B");
    expect(byId["BK-107"].recommendation.notes.join(" ")).toMatch(/Carrier C.*400 kg/);
  });
  it("Balanced depends on the booking: low value -> A, high value -> B", () => {
    expect(pick("BK-101")).toBe("Carrier A");
    expect(pick("BK-108")).toBe("Carrier B");
  });
  it("needed-by date filters out slow carriers", () => {
    // Ready Fri 6 Nov: A arrives Fri 13, B Wed 11, C Tue 10 (working days).
    const b = { ...byId["BK-101"].booking, neededBy: "2026-11-11" };
    expect(analyze(b, TODAY, hs).recommendation.chosen?.option.carrier).toBe("Carrier B");
    const tight = { ...b, neededBy: "2026-11-10" };
    expect(analyze(tight, TODAY, hs).recommendation.chosen?.option.carrier).toBe("Carrier C");
  });
});
