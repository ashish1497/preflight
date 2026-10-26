import { describe, expect, it } from "vitest";
import { encodeWav } from "./recorder";

describe("encodeWav", () => {
  it("writes a valid 16 kHz mono 16-bit PCM header and clamps samples", async () => {
    const blob = encodeWav(new Float32Array([0, 0.5, -0.5, 2, -2]), 16000);
    const v = new DataView(await blob.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect([tag(0), tag(8), tag(36)]).toEqual(["RIFF", "WAVE", "data"]);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(10); // 5 samples × 2 bytes
    expect(v.getInt16(44 + 3 * 2, true)).toBe(0x7fff); // 2 clamps to full scale
    expect(blob.type).toBe("audio/wav");
  });
});
