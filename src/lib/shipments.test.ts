import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { parseWorkbook } from "./parse";
import { actionItems, allowedEvents, pendingDocs, stageOf, statusOf, toShipment } from "./shipments";
import type { HsLookup } from "./hs";

const TODAY = "2026-10-26";
const hs = JSON.parse(readFileSync("public/data/hs.json", "utf8")) as HsLookup;
const buf = readFileSync("public/sample/ShipCheck_sample_bookings.xlsx");
const all = parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer).bookings.map((b) => analyze(b, TODAY, hs));
const ready = all.find((a) => a.booking.id === "BK-107")!; // warehouse, slot booked, collection 13 Nov

describe("shipments", () => {
  const s = toShipment(ready, "SC-261026-1234-2", TODAY, "file", "sample.xlsx");

  it("records carrier, dates and price at booking", () => {
    expect(s.carrier.carrier).toBe("Carrier B");
    expect(s.collection).toBe("2026-11-13");
    expect(s.carrier.eta).toBe("2026-11-18");
  });

  it("moves through stages by date", () => {
    expect(stageOf(s, TODAY)).toBe("awaiting");
    expect(stageOf(s, "2026-11-16")).toBe("transit");
    expect(stageOf(s, "2026-11-18")).toBe("delivered");
  });

  it("lists details still needed and turns them into actions", () => {
    expect(pendingDocs(s).map((d) => d.key)).toEqual(["exporter", "consignee", "sellerEuEori"]); // warehouse → DDP by default
    const done = { ...s, booking: { ...s.booking, exporterEori: "GB123456789000", consigneeName: "Lager GmbH", consigneeAddress: "Hafenstr. 1, Frankfurt", sellerEuEori: "NL123456789" } };
    expect(pendingDocs(done)).toEqual([]);
    const acts = actionItems([s], all.filter((a) => a.booking.id !== "BK-107"), null, TODAY);
    expect(acts[0].title).toMatch(/SC-261026-1234-2: 3 details needed/);
    expect(acts.some((x) => x.title.startsWith("BK-103") && x.tone === "red")).toBe(true);
  });

  it("manual changes move forward only and win over dates", () => {
    expect(allowedEvents(s, TODAY)).toEqual(["collected", "cancelled"]);
    const collected = { ...s, events: [{ type: "collected" as const, at: "2026-11-13", recordedAt: "2026-11-13" }] };
    expect(statusOf(collected, "2026-11-14")).toMatchObject({ stage: "transit", confirmed: true, label: "In transit" });
    expect(allowedEvents(collected, "2026-11-14")).toEqual(["delivered", "cancelled"]);
    const delivered = { ...collected, events: [...collected.events, { type: "delivered" as const, at: "2026-11-17", recordedAt: "2026-11-17" }] };
    expect(statusOf(delivered, "2026-11-17").label).toBe("Delivered");
    expect(allowedEvents(delivered, "2026-11-17")).toEqual([]);
    const cancelled = { ...s, events: [{ type: "cancelled" as const, at: TODAY, recordedAt: TODAY }] };
    expect(statusOf(cancelled, "2026-12-01").stage).toBe("cancelled");
    expect(allowedEvents(cancelled, TODAY)).toEqual([]);
    expect(actionItems([cancelled], [], null, TODAY)).toEqual([]);
  });

  it("asks to confirm collection once the date passes", () => {
    expect(statusOf(s, "2026-11-16").label).toBe("In transit (est.)");
    expect(actionItems([s], [], null, "2026-11-16")[0].title).toMatch(/was it collected/);
  });
});
