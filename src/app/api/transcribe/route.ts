// POST /api/transcribe — raw audio (WAV) in, { text } out. Speech to text with Gemini; audio isn't stored.
import { GeminiError, transcribeAudio } from "@/lib/gemini";

export const maxDuration = 60;

const MAX_BYTES = 4_000_000; // Vercel's request body limit is 4.5 MB
const ALLOWED = /^audio\/(wav|x-wav|wave|mpeg|mp3|ogg|flac|aac|aiff|webm|mp4)/;

// Light abuse guard: public endpoint, so cap calls per IP.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return Response.json({ error: "rate_limited", message: "Too many voice messages in a minute. Try again shortly or type." }, { status: 429 });
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!ALLOWED.test(type)) return Response.json({ error: "bad_type", message: "Unsupported audio format." }, { status: 415 });
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return Response.json({ error: "empty", message: "No audio received." }, { status: 400 });
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: "too_large", message: "That recording is too long. Keep it under about 2 minutes." }, { status: 413 });

  try {
    const text = await transcribeAudio(Buffer.from(buf).toString("base64"), type.split(";")[0]);
    return Response.json({ text: text === "NO_SPEECH" ? "" : text });
  } catch (e) {
    if (e instanceof GeminiError && e.message === "no_key") return Response.json({ error: "no_key", message: "Voice isn't configured on this server. Type instead." }, { status: 503 });
    if (e instanceof GeminiError && e.status === 429) return Response.json({ error: "busy", message: "Voice is busy right now. Try again in a few seconds, or type." }, { status: 429 });
    return Response.json({ error: "api", message: "Couldn't transcribe that. Try again or type." }, { status: 502 });
  }
}
