/**
 * Browser speech-to-text for the chat composer (optional; typing is the default).
 * Uses only the browser's own recogniser (SpeechRecognition / webkitSpeechRecognition).
 * No audio is recorded, stored or sent anywhere by Preflight.
 */

// Minimal types: lib.dom doesn't reliably ship SpeechRecognition, so declare only what we use.
export interface SpeechAlternativeLike {
  readonly transcript: string;
}
export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternativeLike;
}
export interface SpeechResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechResultLike;
}
export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}
export interface SpeechErrorEventLike {
  readonly error: string;
  readonly message?: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEventLike) => void) | null;
  onerror: ((e: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type SpeechWindow = { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };

export const VOICE_UNSUPPORTED = "Voice isn't supported in this browser — type instead";

/** The browser's recogniser constructor, or null (server, Firefox, …). */
export function getRecognitionCtor(w: unknown = typeof window === "undefined" ? undefined : window): SpeechRecognitionCtor | null {
  if (!w) return null;
  const sw = w as SpeechWindow;
  return sw.SpeechRecognition ?? sw.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/** Final and still-changing text from a continuous session's full result list. */
export function joinResults(results: SpeechResultListLike): { final: string; interim: string } {
  const final: string[] = [];
  const interim: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const t = r?.[0]?.transcript?.trim();
    if (!t) continue;
    (r.isFinal ? final : interim).push(t);
  }
  return { final: final.join(" "), interim: interim.join(" ") };
}

/** One line for the composer when the recogniser fails. null = nothing worth telling the seller. */
export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in the address bar, or type instead.";
    case "audio-capture":
      return "No microphone found. Type instead.";
    case "no-speech":
      return "I didn't hear anything. Try the mic again, or type instead.";
    case "network":
      return "Voice needs the browser's speech service, which isn't reachable. Type instead.";
    case "language-not-supported":
      return "This browser can't recognise British English speech. Type instead.";
    default:
      return "Voice input stopped unexpectedly. Type instead.";
  }
}

export interface Recognizer {
  start(): void;
  /** Stop listening; the recogniser finalises what it heard, then calls onEnd. */
  stop(): void;
  /** Stop immediately and drop everything; no further callbacks. */
  abort(): void;
}

/** A configured en-GB continuous recogniser, or null when the browser has none. */
export function createRecognizer(h: {
  onTranscript: (final: string, interim: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}, Ctor: SpeechRecognitionCtor | null = getRecognitionCtor()): Recognizer | null {
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "en-GB";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const { final, interim } = joinResults(e.results);
    h.onTranscript(final, interim);
  };
  rec.onerror = (e) => h.onError(e.error);
  rec.onend = () => h.onEnd();
  const detach = () => {
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
  };
  return {
    start: () => rec.start(),
    stop: () => rec.stop(),
    abort: () => {
      detach();
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
    },
  };
}

// ---- Transcript highlighting (numbers, £ amounts, units) ----

export type TokenKind = "money" | "quantity" | "number" | "unit";
export type Segment = { text: string; kind?: TokenKind };

const NUM = "\\d+(?:,\\d{3})*(?:\\.\\d+)?";
const NUM_WORD = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|dozen)";
const UNIT = "(?:kgs?|kilos?|kilograms?|grams?|g|tonnes?|tons?|lbs?|pallets?|cartons?|boxes|box|cases?|units?|pcs|pieces?|items?|packs?|parcels?|bags?|litres?|liters?)";
// Unit words worth highlighting on their own (no single letters or everyday words).
const UNIT_ALONE = "(?:kgs?|kilos?|kilograms?|grams?|tonnes?|pallets?|cartons?|boxes|pcs)";
const TOKEN = new RegExp(
  [
    `([£€]\\s?${NUM}(?:\\s?(?:k|m)\\b)?|\\b${NUM}\\s?(?:pounds?|quid|gbp|euros?)\\b)`, // 1: money
    `(\\b(?:${NUM}|${NUM_WORD})\\s?${UNIT}\\b)`, // 2: quantity with unit
    `(${NUM}(?:st|nd|rd|th)?)`, // 3: plain number
    `(\\b${UNIT_ALONE}\\b)`, // 4: unit word
  ].join("|"),
  "gi",
);

/** Split text into plain runs and highlighted tokens, in order. Joining every segment's text gives back the input. */
export function highlightTokens(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    if (!m[0]) {
      TOKEN.lastIndex++;
      continue;
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const kind: TokenKind = m[1] ? "money" : m[2] ? "quantity" : m[3] ? "number" : "unit";
    out.push({ text: m[0], kind });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
