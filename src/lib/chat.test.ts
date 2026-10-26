import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { emptyDraft, mergeExtraction, nextQuestions, type Extraction } from "./chat";
import type { HsLookup } from "./hs";

const TODAY = "2026-10-26";
const hs = JSON.parse(readFileSync("public/data/hs.json", "utf8")) as HsLookup;

const nothing: Extraction["booking"] = {
  sellerName: null, originCity: null, destCity: null, destType: null, readyDate: null, neededBy: null, priority: null,
  pallets: null, cartons: null, declaredValue: null, grossWeight: null, appointment: null, incoterm: null, exporterEori: null, consigneeName: null, consigneeAddress: null,
};
const item = (o: Partial<Extraction["items"][number]>): Extraction["items"][number] => ({
  action: "add", match: null, sku: null, description: null, hsCode: null, hsIsSuggestion: false, quantity: null, unitPrice: null,
  unitsPerCarton: null, cartons: null, unitWeight: null, countryOfOrigin: null, ...o,
});

describe("chat booking", () => {
  // What the model returns for: "3 pallets of ceramic mugs from Manchester to an Amazon warehouse in Frankfurt,
  // ready 5 Nov. 1080 mugs at £5, 12 per box, half a kilo each, made in the UK. Cheapest please."
  const first: Extraction = {
    reply: "Got it.",
    booking: { ...nothing, originCity: "Manchester", destCity: "Frankfurt", destType: "Warehouse", readyDate: "2026-11-05", priority: "Cheapest", pallets: 3 },
    items: [item({ description: "Ceramic coffee mug", hsCode: "691200", hsIsSuggestion: true, quantity: 1080, unitPrice: 5, unitsPerCarton: 12, unitWeight: 0.5, countryOfOrigin: "United Kingdom" })],
  };
  let s = mergeExtraction(emptyDraft(), { cartons: false, declaredValue: false }, first, hs);

  it("derives cartons, totals and country from what was said", () => {
    expect(s.booking.destCountry).toBe("Germany");
    expect(s.booking.items[0].cartons).toBe(90);
    expect(s.booking.cartons).toBe(90);
    expect(s.booking.declaredValue).toBe(5400);
    expect(s.derived).toEqual({ cartons: true, declaredValue: true });
  });

  it("asks only for what's missing", () => {
    const q = nextQuestions(s.booking, hs, TODAY).questions.map((x) => [x.text, x.hint, ...x.options.map((o) => o.label)].join(" ")).join(" ");
    expect(q).toMatch(/Which commodity code fits/);
    expect(q).toMatch(/69120023/); // stoneware tableware, one of the choices
    expect(q).toMatch(/gross weight/);
    expect(q).toMatch(/540 kg/); // goods alone
    expect(q).not.toMatch(/how many pallets|which city/i);
  });

  it("questions are numbered choices with a recommendation where we can make one", () => {
    const { questions } = nextQuestions(s.booking, hs, TODAY);
    const gross = questions.find((x) => x.id === "gross")!;
    expect(gross.options[0]).toMatchObject({ recommended: true, label: "About 660 kg" });
    expect(gross.other?.examples.length).toBeGreaterThan(0);
    const hsQ = questions.find((x) => x.id.startsWith("hs-"))!;
    expect(hsQ.options).toHaveLength(8); // 691200 splits into 8 commodity codes, seller picks one
  });

  it("completes and books cheapest", () => {
    s = mergeExtraction(s.booking, s.derived, { reply: "", booking: { ...nothing, grossWeight: 620, appointment: true, sellerName: "Northfield Goods", incoterm: "DDP" }, items: [item({ action: "update", match: "mug", hsCode: "691200", hsIsSuggestion: false })] }, hs);
    expect(nextQuestions(s.booking, hs, TODAY).complete).toBe(true);
    const a = analyze(s.booking, TODAY, hs);
    expect(a.status).toBe("ready");
    expect(a.recommendation.chosen?.option.carrier).toBe("Carrier A");
  });

  it("re-checks after a mid-conversation change: 'add a pallet' and heavier load", () => {
    s = mergeExtraction(s.booking, s.derived, { reply: "", booking: { ...nothing, pallets: 4 }, items: [] }, hs);
    expect(analyze(s.booking, TODAY, hs).recommendation.chosen?.freight).toBe(720);
    // Seller now says it's 2,400 kg: 600 kg/pallet, too heavy for A (500), so B.
    s = mergeExtraction(s.booking, s.derived, { reply: "", booking: { ...nothing, grossWeight: 2400 }, items: [] }, hs);
    const a = analyze(s.booking, TODAY, hs);
    expect(a.recommendation.chosen?.option.carrier).toBe("Carrier B");
    expect(a.recommendation.notes.join(" ")).toMatch(/Carrier A.*500 kg/);
  });

  it("changing an item quantity recalculates the derived totals", () => {
    s = mergeExtraction(s.booking, s.derived, { reply: "", booking: nothing, items: [item({ action: "update", match: "mug", quantity: 1200 })] }, hs);
    expect(s.booking.items[0].cartons).toBe(90); // seller said cartons stay; R-03 should now fire
    expect(s.booking.declaredValue).toBe(6000);
    expect(analyze(s.booking, TODAY, hs).issues.map((i) => i.rule)).toContain("R-03");
  });

  it("expands a suggested 6-digit HS code to its only 8-digit commodity code", () => {
    const r = mergeExtraction(emptyDraft(), { cartons: false, declaredValue: false }, { reply: "", booking: { ...nothing, originCity: "Leeds", destCity: "Paris", destType: "Business address" }, items: [item({ description: "Cotton seeds for sowing", hsCode: "120721", hsIsSuggestion: true, quantity: 100, unitPrice: 3, unitsPerCarton: 10, unitWeight: 1, countryOfOrigin: "India" })] }, hs);
    expect(r.booking.items[0].hsCode).toBe("12072100");
    const hsQ = nextQuestions(r.booking, hs, TODAY).questions.find((x) => x.id.startsWith("hs-"))!;
    expect(hsQ.options[0]).toMatchObject({ label: "Yes, use 12072100", recommended: true });
  });

  it("asks who pays duty, recommending DDP for warehouses", () => {
    const r = mergeExtraction(emptyDraft(), { cartons: false, declaredValue: false }, { reply: "", booking: { ...nothing, originCity: "Leeds", destCity: "Paris", destType: "Warehouse", readyDate: "2026-11-05", priority: "Cheapest", pallets: 1, grossWeight: 100, appointment: true }, items: [item({ description: "Wool throw", hsCode: "63012010", quantity: 10, unitPrice: 20, unitsPerCarton: 10, unitWeight: 1, countryOfOrigin: "Turkey" })] }, hs);
    const q = nextQuestions(r.booking, hs, TODAY).questions.find((x) => x.id === "incoterm")!;
    expect(q.options[0]).toMatchObject({ label: "I pay (DDP)", recommended: true });
  });

  it("rejects an invalid suggested HS code", () => {
    const r = mergeExtraction(emptyDraft(), { cartons: false, declaredValue: false }, { reply: "", booking: nothing, items: [item({ description: "Thing", hsCode: "999999", hsIsSuggestion: true })] }, hs);
    expect(r.booking.items[0].hsCode).toBeNull();
  });
});
