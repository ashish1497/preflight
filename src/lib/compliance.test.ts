import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { COVERAGE_MATRIX, buildChecklist, landedCost, parsePct, type TariffByItem } from "./compliance";
import type { TariffResult } from "./tariff";
import type { Booking, Item } from "./types";

const TODAY = "2026-10-26";

const mug: Item = { sku: "MUG-01", description: "Stoneware coffee mug, 300 ml", hsCode: "69120023", quantity: 480, unitPrice: 3, unitsPerCarton: 24, cartons: 20, unitWeight: 0.4, countryOfOrigin: "China" };
const tee: Item = { sku: "TEE-01", description: "Men's cotton T-shirt, size M", hsCode: "61091000", quantity: 200, unitPrice: 6, unitsPerCarton: 20, cartons: 10, unitWeight: 0.2, countryOfOrigin: "India" };

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: "BK-T", sellerName: "Test Ltd", originCity: "Manchester", originCountry: "United Kingdom", destCity: "Frankfurt", destCountry: "Germany",
    destType: "Business address", readyDate: "2026-10-28", priority: "Cheapest", pallets: 1, cartons: 20, declaredValue: 1440, currency: "GBP",
    grossWeight: 220, appointment: null, items: [mug], incoterm: "DAP", ...over,
  };
}

const mugTariff: TariffResult = {
  code: "69120023", apiCode: "6912002300", subcodes: ["6912002310", "6912002390"], origin: "China", dest: "Germany",
  euImport: {
    duties: [
      { label: "Standard (third country) duty", rate: "5.50 %", allSubcodes: true },
      { label: "Anti-dumping duty (China)", rate: "79.00 %", allSubcodes: false },
    ],
    controls: [
      {
        type: "Import control - Waste",
        documents: [{ code: "C672", description: "Information document accompanying shipments of waste" }],
        waivers: [{ code: "Y923", description: "Product not subjected to the provisions of Regulation (EU) 2024/1157" }],
        allSubcodes: true,
      },
    ],
  },
  ukExport: { controls: [] },
  links: { eu: "https://www.trade-tariff.service.gov.uk/xi/commodities/6912002310", uk: "https://www.trade-tariff.service.gov.uk/commodities/6912002390" },
};

const run = (b: Booking, t: TariffByItem = { 0: mugTariff }) => buildChecklist(analyze(b, TODAY, null), t);

describe("buildChecklist", () => {
  it("warns about anti-dumping duty and says who pays under each Incoterm", () => {
    const dap = run(booking({ incoterm: "DAP" })).find((i) => /anti-dumping/i.test(i.title))!;
    expect(dap.type).toBe("warning");
    expect(dap.stage).toBe("collection");
    expect(dap.title).toContain("79%");
    expect(dap.owner).toBe("Receiver");
    expect(dap.why).toContain("your receiver (DAP)");

    const ddp = run(booking({ incoterm: "DDP" })).find((i) => /anti-dumping/i.test(i.title))!;
    expect(ddp.owner).toBe("You");
    expect(ddp.why).toContain("you (DDP)");
  });

  it("turns a control with a waiver into an exemption task that is done once confirmed", () => {
    const task = run(booking()).find((i) => i.action?.kind === "confirm")!;
    expect(task.type).toBe("task");
    expect(task.title).toMatch(/C672.*Y923/);
    expect(task.action).toEqual({ kind: "confirm", key: "0:Import control - Waste" });
    expect(task.done).toBe(false);

    const after = run(booking({ confirmations: { "0:Import control - Waste": true } })).find((i) => i.id === task.id)!;
    expect(after.done).toBe(true);
  });

  it("adds the textile labelling advisory for a T-shirt (chapter 61), never as a blocker", () => {
    const list = run(booking({ items: [tee], cartons: 10, declaredValue: 1200 }), {});
    const adv = list.find((i) => i.id === "collection:advisory:textile")!;
    expect(adv.type).toBe("advisory");
    expect(adv.source?.url).toContain("eur-lex.europa.eu/eli/reg/2011/1007");
    expect(adv.why).toContain("Access2Markets");
  });

  it("matches 7-digit chapter 01–09 codes by their padded chapter only", () => {
    const coffee: Item = { ...tee, sku: "COF", description: "Roasted coffee beans, 1 kg bag", hsCode: "9012100" };
    const list = run(booking({ items: [coffee], cartons: 10, declaredValue: 1200 }), {});
    expect(list.some((i) => i.type === "advisory")).toBe(false); // not chapter 90
  });

  it("puts border formalities on the carrier", () => {
    const border = run(booking()).filter((i) => i.stage === "border");
    expect(border.map((i) => i.id)).toEqual(["border:export-declaration", "border:gvms", "border:ics2"]);
    for (const i of border) expect(i.owner).toBe("Carrier");
  });

  it("maps failed checks to blockers and a clean booking to one passed item", () => {
    const clean = run(booking());
    expect(clean.filter((i) => i.stage === "booking").map((i) => i.title)).toEqual(["All 11 checks passed"]);
    const bad = run(booking({ declaredValue: 2000 })).filter((i) => i.stage === "booking");
    expect(bad[0]).toMatchObject({ type: "blocker", action: { kind: "field", field: "declaredValue" } });
  });

  it("asks for the right EU EORI per Incoterm", () => {
    expect(run(booking({ incoterm: "DAP" })).find((i) => i.id === "collection:eu-eori-dap")?.owner).toBe("Receiver");
    expect(run(booking({ incoterm: "DDP" })).find((i) => i.id === "collection:eu-eori-ddp")?.owner).toBe("You");
  });

  it("adds GPSR for warehouse (consumer) deliveries", () => {
    expect(run(booking({ destType: "Warehouse", appointment: true })).some((i) => i.id === "collection:advisory:gpsr")).toBe(true);
  });
});

describe("landedCost", () => {
  it("adds duty + anti-dumping on goods value plus freight share, then import VAT", () => {
    const a = analyze(booking(), TODAY, null);
    const lc = landedCost(a, { 0: mugTariff });
    const freight = a.recommendation.chosen!.freight;
    const cv = 1440 + freight;
    expect(lc.lines[0].customsValue).toBeCloseTo(cv);
    expect(lc.lines[0].dutyRate).toBeCloseTo(84.5);
    expect(lc.totals.duty).toBeCloseTo(cv * 0.845);
    expect(lc.totals.vat).toBeCloseTo(cv * 1.845 * 0.19);
    expect(lc.payer.owner).toBe("Receiver");
  });

  it("parses only plain percentages", () => {
    expect(parsePct("5.50 %")).toBe(5.5);
    expect(parsePct("8.00 % + 9.40 EUR / 100 kg")).toBeNull();
  });
});

describe("COVERAGE_MATRIX", () => {
  it("lists all 11 checks and the known gaps", () => {
    expect(COVERAGE_MATRIX.filter((r) => r.status === "Checked (blocks/warns)").length).toBeGreaterThanOrEqual(11);
    expect(COVERAGE_MATRIX.some((r) => /sanctions/i.test(r.area) && r.status === "Not covered")).toBe(true);
  });
});
