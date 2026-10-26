import { describe, expect, it } from "vitest";
import { createRecognizer, getRecognitionCtor, highlightTokens, joinResults, speechErrorMessage, type SpeechRecognitionLike, type SpeechResultListLike } from "./speech";

const results = (...rs: [string, boolean][]): SpeechResultListLike =>
  Object.assign(rs.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal })), {}) as unknown as SpeechResultListLike;

describe("speech", () => {
  it("feature-detects the standard and webkit recognisers", () => {
    class Rec {}
    expect(getRecognitionCtor(undefined)).toBeNull();
    expect(getRecognitionCtor({})).toBeNull();
    expect(getRecognitionCtor({ webkitSpeechRecognition: Rec })).toBe(Rec);
    expect(getRecognitionCtor({ SpeechRecognition: Rec })).toBe(Rec);
  });

  it("joins final and interim results", () => {
    expect(joinResults(results([" 3 pallets of mugs", true], ["to Frankfurt", true], [" ready next", false]))).toEqual({
      final: "3 pallets of mugs to Frankfurt",
      interim: "ready next",
    });
  });

  it("highlights money, quantities and numbers without losing text", () => {
    const text = "3 pallets of mugs at £5.50 each, 1,080 units, half a kilo, ready 5 Nov, e.g. cheapest";
    const segs = highlightTokens(text);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    const marked = segs.filter((s) => s.kind).map((s) => [s.text, s.kind]);
    expect(marked).toEqual([
      ["3 pallets", "quantity"],
      ["£5.50", "money"],
      ["1,080 units", "quantity"],
      ["kilo", "unit"],
      ["5", "number"],
    ]);
  });

  it("reads spoken amounts in pounds and number words", () => {
    const marked = highlightTokens("twelve cartons worth 200 pounds").filter((s) => s.kind);
    expect(marked).toEqual([
      { text: "twelve cartons", kind: "quantity" },
      { text: "200 pounds", kind: "money" },
    ]);
  });

  it("explains errors in one line and ignores aborts", () => {
    expect(speechErrorMessage("aborted")).toBeNull();
    expect(speechErrorMessage("not-allowed")).toMatch(/blocked/);
    expect(speechErrorMessage("something-new")).toMatch(/type instead/i);
  });

  it("configures en-GB continuous recognition with interim results; abort detaches callbacks", () => {
    let made: SpeechRecognitionLike | null = null;
    class Fake implements SpeechRecognitionLike {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 0;
      onresult: SpeechRecognitionLike["onresult"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      started = false;
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        made = this;
      }
      start() { this.started = true; }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    const seen: string[] = [];
    const r = createRecognizer({ onTranscript: (f, i) => seen.push(`${f}|${i}`), onError: (c) => seen.push(`err:${c}`), onEnd: () => seen.push("end") }, Fake)!;
    r.start();
    const rec = made as unknown as Fake;
    expect([rec.lang, rec.continuous, rec.interimResults, rec.started]).toEqual(["en-GB", true, true, true]);
    rec.onresult?.({ resultIndex: 0, results: results(["hello", true], ["wor", false]) });
    rec.onerror?.({ error: "no-speech" });
    r.stop();
    r.abort();
    expect(seen).toEqual(["hello|wor", "err:no-speech", "end"]);
  });
});
