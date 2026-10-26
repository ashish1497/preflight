// Server-only Gemini client with key + model rotation.
// Keys: GOOGLE_GEMINI_KEY, GOOGLE_GEMINI_KEY_2, GOOGLE_GEMINI_KEY_3, ... tried in order.

const MODELS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-2.5-flash"];
const URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export function geminiKeys(): string[] {
  return Object.keys(process.env)
    .filter((k) => /^GOOGLE_GEMINI_KEY(_\d+)?$/.test(k))
    .sort((a, b) => (Number(a.split("_")[3] ?? 1) || 1) - (Number(b.split("_")[3] ?? 1) || 1))
    .map((k) => process.env[k]!.trim())
    .filter(Boolean);
}

// Remember which key last worked so we don't retry a dead one on every request.
let preferred = 0;

export class GeminiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface GeminiTurn {
  role: "user" | "model";
  text: string;
}

/** Ask Gemini for JSON matching `schema`. Rotates keys on 401/403/429/5xx, then falls back to the next model. */
export async function generateJson(opts: { system: string; turns: GeminiTurn[]; schema: object; timeoutMs?: number }): Promise<unknown> {
  const keys = geminiKeys();
  if (!keys.length) throw new GeminiError("no_key", 503);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: opts.schema,
      thinkingConfig: { thinkingLevel: "low" },
      maxOutputTokens: 4000,
    },
  });

  let last: GeminiError = new GeminiError("unavailable", 502);
  for (const model of MODELS) {
    for (let n = 0; n < keys.length; n++) {
      const ki = (preferred + n) % keys.length;
      let res: Response;
      try {
        res = await fetch(URL(model), {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": keys[ki] },
          body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
        });
      } catch {
        last = new GeminiError("timeout", 504);
        continue;
      }
      if (res.ok) {
        preferred = ki;
        const data = await res.json();
        const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
        try {
          return JSON.parse(text);
        } catch {
          last = new GeminiError("bad_json", 502);
          continue;
        }
      }
      last = new GeminiError(`http_${res.status}`, res.status);
      // Bad request won't get better with another key; try the next model.
      if (res.status === 400 || res.status === 404) break;
    }
  }
  throw last;
}

const TRANSCRIBE_PROMPT = `Transcribe this audio exactly as spoken. The speaker is a UK business owner describing a freight shipment to the EU: products, quantities, prices in pounds, weights in kg, pallets, cartons, UK and EU cities (Manchester, Birmingham, Leeds, London, Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam, Rotterdam), dates, and words like warehouse, HS code, EORI.
Write numbers as digits (1080, not "one thousand and eighty"; £5, not "five pounds"). Keep the speaker's wording; don't summarise or answer. Output only the transcript. If there is no speech, output exactly: NO_SPEECH`;

/** Speech to text with Gemini audio input. Rotates keys and models like generateJson. */
export async function transcribeAudio(base64: string, mimeType: string, timeoutMs = 30000): Promise<string> {
  const keys = geminiKeys();
  if (!keys.length) throw new GeminiError("no_key", 503);
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: TRANSCRIBE_PROMPT }, { inlineData: { mimeType, data: base64 } }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 2000 },
  });
  let last: GeminiError = new GeminiError("unavailable", 502);
  for (const model of MODELS) {
    for (let n = 0; n < keys.length; n++) {
      const ki = (preferred + n) % keys.length;
      let res: Response;
      try {
        res = await fetch(URL(model), { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": keys[ki] }, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        last = new GeminiError("timeout", 504);
        continue;
      }
      if (res.ok) {
        preferred = ki;
        const data = await res.json();
        const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
        return parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("").trim();
      }
      last = new GeminiError(`http_${res.status}`, res.status);
      if (res.status === 400 || res.status === 404) break;
    }
  }
  throw last;
}
