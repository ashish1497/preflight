// Microphone recording for Gemini speech-to-text. Records with MediaRecorder, then converts to
// 16 kHz mono 16-bit WAV in the browser so every browser sends the same format Gemini supports.

export const MAX_RECORD_SECONDS = 90;
const TARGET_RATE = 16000;

export function isRecordingSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export interface Recording {
  /** Stop and return the audio as WAV. */
  stop: () => Promise<Blob>;
  /** Stop and throw the audio away. */
  cancel: () => void;
}

export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  const timer = setTimeout(() => onAutoStop?.(), MAX_RECORD_SECONDS * 1000);
  rec.start();

  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        clearTimeout(timer);
        rec.onstop = async () => {
          stopTracks();
          try {
            resolve(await toWav(new Blob(chunks, { type: rec.mimeType })));
          } catch (e) {
            reject(e);
          }
        };
        if (rec.state !== "inactive") rec.stop();
        else rec.onstop?.(new Event("stop"));
      }),
    cancel: () => {
      clearTimeout(timer);
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      stopTracks();
    },
  };
}

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    // Resample to 16 kHz mono.
    const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const off = new OfflineAudioContext(1, length, TARGET_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    return encodeWav(pcm, TARGET_RATE);
  } finally {
    void ctx.close();
  }
}

export function encodeWav(pcm: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Plain-language message for getUserMedia errors. */
export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow it in your browser, or type instead.";
  if (name === "NotFoundError") return "No microphone found. Type instead.";
  return "Couldn't start the microphone. Type instead.";
}

export async function transcribe(wav: Blob): Promise<{ text: string } | { error: string }> {
  const r = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav }).catch(() => null);
  if (!r) return { error: "Couldn't reach the voice service. Try again or type." };
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { error: d.message ?? "Couldn't transcribe that. Try again or type." };
  return { text: String(d.text ?? "") };
}
