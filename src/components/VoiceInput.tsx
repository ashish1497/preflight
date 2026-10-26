"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { highlightTokens, VOICE_UNSUPPORTED } from "@/lib/speech";
import { isRecordingSupported, micErrorMessage, startRecording, transcribe, type Recording } from "@/lib/recorder";
import { Button, IconButton, cx } from "./ui";

export type VoiceState = "idle" | "listening" | "transcribing" | "review";

const noSubscribe = () => () => {};

/**
 * Optional voice input, transcribed by Gemini: idle → listening (recording) → transcribing → review
 * (editable transcript) → send. Never starts on its own. The recording is sent for transcription
 * only; nothing is stored.
 */
export function useVoice() {
  const supported = useSyncExternalStore(noSubscribe, isRecordingSupported, () => false);
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const cancelled = useRef(false);

  // Count seconds while recording.
  useEffect(() => {
    if (state !== "listening") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  // Leaving the page mid-sentence: stop the microphone.
  useEffect(() => () => rec.current?.cancel(), []);

  async function start() {
    if (rec.current || state !== "idle") return;
    setError(null);
    cancelled.current = false;
    try {
      rec.current = await startRecording(() => void stop());
      setSeconds(0);
      setState("listening");
    } catch (e) {
      rec.current = null;
      setError(micErrorMessage(e));
    }
  }

  /** Finish recording, send it for transcription, then move to review. */
  async function stop() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setState("transcribing");
    try {
      const wav = await r.stop();
      if (cancelled.current) return;
      const res = await transcribe(wav);
      if (cancelled.current) return;
      if ("error" in res) {
        setError(res.error);
        setState("idle");
      } else if (!res.text.trim()) {
        setError("I didn't catch anything. Try again, or type.");
        setState("idle");
      } else {
        setDraft(res.text.trim());
        setState("review");
      }
    } catch {
      if (!cancelled.current) {
        setError("Couldn't process that recording. Try again or type.");
        setState("idle");
      }
    }
  }

  function discard() {
    cancelled.current = true;
    rec.current?.cancel();
    rec.current = null;
    setDraft("");
    setSeconds(0);
    setState("idle");
  }

  return { supported, state, seconds, draft, setDraft, error, start, stop, discard };
}

export type Voice = ReturnType<typeof useVoice>;

const ANNOUNCE: Record<VoiceState, string> = {
  idle: "",
  listening: "Recording. Speak your booking, then press Stop.",
  transcribing: "Transcribing your recording.",
  review: "Stopped listening. Check the transcript, then send or discard it.",
};

/** Mic button for the composer row. Disabled with a reason when the browser can't do speech. */
export function VoiceButton({ voice, disabled }: { voice: Voice; disabled?: boolean }) {
  const title = voice.supported ? "Speak instead of typing (optional, transcribed by Gemini)" : VOICE_UNSUPPORTED;
  return (
    // The wrapper carries the tooltip too: some browsers don't show titles on disabled buttons.
    <span title={title} className="inline-flex">
      <IconButton
        type="button"
        aria-label={voice.supported ? "Speak instead of typing" : VOICE_UNSUPPORTED}
        title={title}
        disabled={!voice.supported || disabled}
        active={voice.state === "listening"}
        onClick={voice.start}
      >
        <Mic className="h-4 w-4" />
      </IconButton>
    </span>
  );
}

/** Screen-reader announcements for voice state changes and errors. */
export function VoiceStatus({ voice }: { voice: Voice }) {
  return (
    <p className="sr-only" aria-live="polite">
      {voice.error ?? ANNOUNCE[voice.state]}
    </p>
  );
}

/** One-line note under the composer (permission denied, nothing heard, …). */
export function VoiceNote({ voice }: { voice: Voice }) {
  if (!voice.error || voice.state !== "idle") return null;
  return <p className="px-3 pb-2 -mt-1 text-xs text-amber-800">{voice.error}</p>;
}

/** Transcript with numbers, £ amounts and units shown as chips, so the seller can spot mishearings. */
export function TranscriptPreview({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cx("text-sm leading-7 text-slate-700", className)}>
      {highlightTokens(text).map((s, i) =>
        s.kind ? (
          <span key={i} className="mx-0.5 rounded-full bg-ai-soft px-1.5 py-0.5 font-medium tabular-nums text-ai ring-1 ring-inset ring-ai/20">{s.text}</span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

/** Replaces the composer row while listening or reviewing. */
export function VoicePanel({ voice, busy, onSend }: { voice: Voice; busy?: boolean; onSend: (text: string) => void }) {
  if (voice.state === "listening" || voice.state === "transcribing") {
    const busyT = voice.state === "transcribing";
    const mm = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}`;
    return (
      <div className="space-y-2 border-t border-slate-200 p-3">
        <div className="flex items-center gap-2">
          {busyT ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
          ) : (
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
            </span>
          )}
          <span className={cx("flex-1 text-sm font-medium", busyT ? "text-slate-700" : "text-red-700")}>
            {busyT ? "Transcribing…" : <>Recording <span className="tabular-nums">{mm}</span></>}
          </span>
          {!busyT && (
            <>
              <Button variant="ghost" onClick={voice.discard}>Cancel</Button>
              <Button variant="secondary" onClick={voice.stop}>
                <Square className="h-3.5 w-3.5 fill-current" />Stop
              </Button>
            </>
          )}
        </div>
        <p className="min-h-[2.75rem] rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">
          {busyT ? "Turning your voice into text with Gemini…" : "Speak now, e.g. “3 pallets of mugs to Frankfurt, £5 each”. Press Stop when you're done."}
        </p>
      </div>
    );
  }

  if (voice.state === "review") {
    const send = () => {
      if (!voice.draft.trim() || busy) return;
      onSend(voice.draft);
      voice.discard();
    };
    return (
      <div className="space-y-2 border-t border-slate-200 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Check what I heard</p>
        <TranscriptPreview text={voice.draft} className="rounded-lg bg-slate-50 px-3 py-1.5" />
        <textarea
          value={voice.draft}
          onChange={(e) => voice.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
          autoFocus
          aria-label="Edit the transcript before sending"
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={voice.discard}>Discard</Button>
          <Button onClick={send} disabled={busy || !voice.draft.trim()}>Send</Button>
        </div>
      </div>
    );
  }

  return null;
}
