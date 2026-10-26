"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Paperclip, RotateCcw, SendHorizontal, User } from "lucide-react";
import { analyze, applyPatches } from "@/lib/analyze";
import { emptyDraft, mergeExtraction, nextQuestions, type Derived, type Extraction, type Question } from "@/lib/chat";
import type { HsLookup } from "@/lib/hs";
import type { Analysis, Booking, FileSummary, Patch } from "@/lib/types";
import { BookingPanel } from "./BookingPanel";
import { ruleName } from "@/lib/reference";
import { Questionnaire, type Answer } from "./Questionnaire";
import { Button, IconButton, cx } from "./ui";
import { BOOKING_FILE_ACCEPT, ChatDropzone, pickBookingFile } from "./ChatDropzone";
import { FileChip, FileSummaryCard } from "./FileSummaryCard";
import { useVoice, VoiceButton, VoiceNote, VoicePanel, VoiceStatus } from "./VoiceInput";

type Msg = {
  role: "user" | "assistant";
  content: string;
  note?: string;
  questions?: Question[];
  display?: string;
  /** A bookings file the seller attached or dropped. */
  file?: { name: string; size: number };
  /** The check result for that file. */
  summary?: FileSummary;
  /** Shown in chat only, never sent to the AI (file results, rejected drops). */
  local?: boolean;
};

const GREETING: Msg = {
  role: "assistant",
  content: "Hi! Tell me about your shipment in your own words: what you're sending, how much, and where it's going. I'll ask only for what's missing and check everything before it leaves.",
};

const EXAMPLES = [
  "3 pallets of ceramic mugs from Manchester to an Amazon warehouse in Frankfurt, ready 5 Nov. 1080 mugs at £5, 12 per box, half a kilo each, made in the UK. Cheapest please.",
  "I need to send 200 wool blankets from Leeds to a shop in Lyon next Monday, £22 each, made in Turkey, needs to be there fast.",
  "Sending power banks and phone cases to Amsterdam",
];

const NO_EXTRACTION: Extraction = {
  reply: "",
  booking: { sellerName: null, originCity: null, destCity: null, destType: null, readyDate: null, neededBy: null, priority: null, pallets: null, cartons: null, declaredValue: null, grossWeight: null, appointment: null, incoterm: null, exporterEori: null, consigneeName: null, consigneeAddress: null },
  items: [],
};

const FIELDS: (keyof Booking)[] = ["sellerName", "originCity", "destCity", "destType", "readyDate", "neededBy", "priority", "pallets", "cartons", "declaredValue", "grossWeight", "appointment"];

function statusLine(before: Analysis | null, after: Analysis): string {
  const r = after.issues.filter((i) => i.severity === "red");
  const am = after.issues.filter((i) => i.severity === "amber");
  const rules = (xs: typeof r) => [...new Set(xs.map((i) => ruleName(i.rule)))].join(", ");
  const parts: string[] = [];
  if (r.length) parts.push(`${r.length} must-fix (${rules(r)})`);
  if (am.length) parts.push(`${am.length} to check (${rules(am)})`);
  const c = after.recommendation.chosen;
  const pick = c ? ` Carrier: ${c.option.carrier}, ${c.option.service}.` : "";
  const prevPick = before?.recommendation.chosen?.option.carrier;
  const changedPick = prevPick && c && prevPick !== c.option.carrier ? ` (changed from ${prevPick})` : "";
  return (parts.length ? `Checks: ${parts.join(", ")}.` : "Checks: all clear so far.") + pick + changedPick;
}

export function ChatView({ hs, today, onConfirm, onDocs, onShare, onDraft, onFile, onOpenBulk }: {
  /** A bookings file dropped/attached in chat. Agent B wires the UI. */
  onFile?: (file: File) => Promise<FileSummary | { error: string }>;
  /** Open Bulk check, optionally at one booking. */
  onOpenBulk?: (id?: string) => void;
  onDraft: (a: Analysis | null) => void;
  onShare: (a: Analysis) => void;
  hs: HsLookup | null;
  today: string;
  onConfirm: (a: Analysis) => void;
  onDocs: (a: Analysis, k: "invoice" | "packing") => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [draft, setDraft] = useState<Booking>(emptyDraft);
  const [derived, setDerived] = useState<Derived>({ cartons: false, declaredValue: false });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiDown, setAiDown] = useState(false);
  const [changed, setChanged] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const voice = useVoice();

  const analysis = useMemo(() => analyze(draft, today, hs), [draft, today, hs]);
  // Tell the dashboard about the booking in progress (nothing until the seller has started).
  useEffect(() => {
    onDraft(draft.items.length || draft.destCity || draft.originCity ? analysis : null);
  }, [analysis, draft, onDraft]);
  const started = msgs.length > 1;
  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy, checking]);
  useEffect(() => {
    if (!changed.length) return;
    const t = setTimeout(() => setChanged([]), 1600);
    return () => clearTimeout(t);
  }, [changed]);

  /** Show the next numbered questions (or the "all set" note) after the draft changed. */
  function advance(prev: Booking, next: Booking, nextDerived: Derived, reply: string) {
    const before = analyze(prev, today, hs);
    const after = analyze(next, today, hs);
    setChanged(FIELDS.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(next[f])));
    setDraft(next);
    setDerived(nextDerived);
    const { questions, complete } = nextQuestions(next, hs, today);
    const tail = complete
      ? after.status === "blocked"
        ? "That's everything I need, but some checks must be fixed before this can be booked. See the red items on the right."
        : "That's everything I need. Review the checks and carrier on the right, then confirm."
      : questions.length > 1
        ? `A few questions to complete the booking:`
        : `One question to complete the booking:`;
    setMsgs((m) => [...m, { role: "assistant", content: `${reply || "Got it."}\n\n${tail}`, note: statusLine(before, after), questions: complete ? undefined : questions }]);
  }

  /** Free text goes to the AI to read into fields. */
  async function send(content: string, display?: string, base?: { draft: Booking; derived: Derived }) {
    if (!content.trim() || busy) return;
    const from = base ?? { draft, derived };
    const history = [...msgs, { role: "user" as const, content, display }];
    setMsgs(history);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The AI sees the questions we asked, numbered, so it can match answers to them.
        body: JSON.stringify({ messages: history.slice(1).filter((m) => !m.file && !m.summary && !m.local).map((m) => ({ role: m.role, content: m.content + (m.questions ? "\n" + m.questions.map((q, i) => `${i + 1}. ${q.text}`).join("\n") : "") })), draft: from.draft, today }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.extraction) {
        if (res.status === 503 || res.status === 429 || res.status >= 500) setAiDown(true);
        if (base) { setDraft(base.draft); setDerived(base.derived); }
        setMsgs((m) => [...m, { role: "assistant", content: data.message ?? "Something went wrong. You can fill the booking card on the right directly." }]);
        return;
      }
      setAiDown(false);
      const x = data.extraction as Extraction;
      const merged = mergeExtraction(from.draft, from.derived, x, hs);
      advance(draft, merged.booking, merged.derived, x.reply);
    } catch {
      setAiDown(true);
      setMsgs((m) => [...m, { role: "assistant", content: "I couldn't reach the assistant. You can fill the booking card on the right directly; every check still runs." }]);
    } finally {
      setBusy(false);
    }
  }

  /** Picked options apply straight to the booking; typed answers go through the AI. */
  function submitAnswers(questions: Question[], answers: Record<string, Answer>) {
    const patches: Patch[] = [];
    const shown: string[] = [];
    const typed: string[] = [];
    questions.forEach((q, i) => {
      const a = answers[q.id];
      if (a?.option != null) {
        const o = q.options[a.option];
        patches.push(...o.patches);
        shown.push(`${i + 1}. ${q.header}: ${o.label}`);
      } else if (a?.text?.trim()) {
        shown.push(`${i + 1}. ${q.header}: ${a.text.trim()}`);
        typed.push(`${i + 1}. ${q.text} → ${a.text.trim()}`);
      }
    });
    const d = { ...derived };
    for (const x of patches) if (x.kind === "booking" && (x.field === "cartons" || x.field === "declaredValue")) d[x.field] = false;
    const merged = mergeExtraction(applyPatches(draft, patches), d, NO_EXTRACTION, hs);
    if (typed.length) {
      send(`My answers:\n${typed.join("\n")}`, shown.join("\n"), { draft: merged.booking, derived: merged.derived });
    } else {
      setMsgs((m) => [...m, { role: "user", content: shown.join("\n") }]);
      advance(draft, merged.booking, merged.derived, "Thanks, updated.");
    }
  }

  function onPatch(p: Patch[]) {
    const d = { ...derived };
    for (const x of p) if (x.kind === "booking" && (x.field === "cartons" || x.field === "declaredValue")) d[x.field] = false;
    const merged = mergeExtraction(applyPatches(draft, p), d, NO_EXTRACTION, hs);
    setDraft(merged.booking);
    setDerived(merged.derived);
  }

  /** A bookings file from the paperclip or a drop: check it, show the summary card. */
  async function checkFile(file: File) {
    if (!onFile) return;
    if (checking) return rejectFile("Still checking the last file. Try again in a moment.");
    setMsgs((m) => [...m, { role: "user", content: `[Uploaded bookings file ${file.name}]`, file: { name: file.name, size: file.size }, local: true }]);
    setChecking(true);
    try {
      const r = await onFile(file);
      setMsgs((m) => [...m, "error" in r
        ? { role: "assistant", content: r.error, local: true }
        : { role: "assistant", content: `Checked ${r.total} bookings from ${r.fileName}.`, summary: r, local: true }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Couldn't read this file. Is it a Preflight booking workbook (.xlsx)?", local: true }]);
    } finally {
      setChecking(false);
    }
  }

  function rejectFile(reason: string) {
    setMsgs((m) => [...m, { role: "assistant", content: reason, local: true }]);
  }

  function reset() {
    voice.discard();
    setMsgs([GREETING]);
    setDraft(emptyDraft());
    setDerived({ cartons: false, declaredValue: false });
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <ChatDropzone
        enabled={!!onFile}
        onFile={checkFile}
        onReject={rejectFile}
        className="flex min-h-0 flex-col border-slate-200 bg-white lg:w-[420px] lg:shrink-0 lg:border-r max-lg:h-[55vh]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <p className="text-sm font-semibold">Book by chat</p>
          {started && <Button variant="ghost" onClick={reset}><RotateCcw className="h-3.5 w-3.5" />Start over</Button>}
        </div>
        {aiDown && <p className="bg-amber-50 px-4 py-2 text-xs text-amber-900">Assistant offline. Edit the booking card directly; all checks and the carrier pick still work.</p>}
        <div className="flex-1 space-y-3 overflow-y-auto p-4 scroll-thin">
          {msgs.map((m, i) => (
            <div key={i} className={cx("flex gap-2", m.role === "user" && "flex-row-reverse")}>
              <span className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-slate-200" : "bg-ink text-white")}>
                {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </span>
              <div className={cx("min-w-0", (m.questions && i === msgs.length - 1) || m.summary ? "w-full" : "max-w-[85%]")}>
                {m.summary ? (
                  <FileSummaryCard summary={m.summary} onOpenBulk={onOpenBulk} />
                ) : (
                  <div className={cx("whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm", m.role === "user" ? "bg-brand text-white" : "bg-slate-100 text-slate-900")}>
                    {m.file ? <FileChip name={m.file.name} size={m.file.size} /> : m.display ?? m.content}
                    {m.note && <p className="mt-1.5 border-t border-slate-200 pt-1.5 text-xs text-slate-600">{m.note}</p>}
                  </div>
                )}
                {m.questions && i === msgs.length - 1 && (
                  <Questionnaire key={i} questions={m.questions} disabled={busy} onSubmit={(a) => submitAnswers(m.questions!, a)} />
                )}
                {m.questions && i < msgs.length - 1 && (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-8 text-xs text-slate-500">{m.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ol>
                )}
              </div>
            </div>
          ))}
          {busy && <p className="pl-9 text-sm text-slate-500">Reading your message…</p>}
          {checking && <p className="pl-9 text-sm text-slate-500" role="status">Checking file…</p>}
          {!started && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Try one</p>
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => send(e)} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left text-sm text-slate-700 hover:border-brand/40 hover:bg-brand-soft/40">{e}</button>
              ))}
              {onFile && <p className="pt-1 text-xs text-slate-500">Have a spreadsheet of bookings? Attach it with the paperclip or drop it here.</p>}
            </div>
          )}
          <div ref={end} />
        </div>
        {voice.state !== "idle" ? (
          <VoicePanel voice={voice} busy={busy} onSend={(t) => send(t)} />
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-center gap-1.5 border-t border-slate-200 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Message"
              placeholder={started ? "Answer, or change anything (e.g. “add a pallet”)" : "Describe your shipment…"}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
            />
            {onFile && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept={BOOKING_FILE_ACCEPT}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const r = pickBookingFile(e.target.files);
                    e.target.value = "";
                    if ("error" in r) rejectFile(r.error);
                    else checkFile(r.file);
                  }}
                />
                <IconButton type="button" aria-label="Attach a bookings file" title="Attach a bookings file (.xlsx, .xls, .ods, .csv)" disabled={checking} onClick={() => fileInput.current?.click()}>
                  <Paperclip className="h-4 w-4" />
                </IconButton>
              </>
            )}
            <VoiceButton voice={voice} disabled={busy} />
            <Button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="h-9"><SendHorizontal className="h-4 w-4" /></Button>
          </form>
        )}
        <VoiceNote voice={voice} />
        <VoiceStatus voice={voice} />
      </ChatDropzone>
      <div className="min-h-0 flex-1">
        <BookingPanel
          analysis={analysis}
          today={today}
          hs={hs}
          onPatch={onPatch}
          onConfirm={() => onConfirm(analysis)}
          onDocs={(k) => onDocs(analysis, k)}
          onShare={() => onShare(analysis)}
          derived={derived}
          changed={changed}
        />
      </div>
    </div>
  );
}
