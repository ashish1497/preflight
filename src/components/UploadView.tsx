"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { analyze, applyPatches } from "@/lib/analyze";
import { gbp } from "@/lib/carriers";
import type { HsLookup } from "@/lib/hs";
import { parseWorkbook } from "@/lib/parse";
import { ruleName } from "@/lib/reference";
import type { Analysis, Booking, Patch } from "@/lib/types";
import { BookingPanel } from "./BookingPanel";
import { Button, cx, SevChip, StatusPill } from "./ui";

const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false, loading: () => <div className="h-[150px] animate-pulse rounded-xl bg-slate-100" /> });

const SAMPLE ="/sample/ShipCheck_sample_bookings.xlsx";

export interface FileState {
  bookings: Booking[];
  warnings: string[];
  fileName: string | null;
}
export const EMPTY_FILE: FileState = { bookings: [], warnings: [], fileName: null };

export function UploadView({ hs, today, onConfirm, onDocs, onShare, onFileChecked, confirmed, file, setFile, analyses, selected, setSelected }: {
  file: FileState;
  setFile: (f: FileState | ((f: FileState) => FileState)) => void;
  analyses: Analysis[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  onShare: (a: Analysis) => void;
  onFileChecked: (a: Analysis[], fileName: string) => void;
  hs: HsLookup | null;
  today: string;
  onConfirm: (a: Analysis) => void;
  onDocs: (a: Analysis, k: "invoice" | "packing") => void;
  confirmed: Record<string, string>;
}) {
  const { bookings, warnings, fileName } = file;
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const current = analyses.find((a) => a.booking.id === selected) ?? null;

  async function load(buf: ArrayBuffer, name: string) {
    try {
      const r = parseWorkbook(buf);
      if (!r.bookings.length) throw new Error(r.warnings[0] ?? "No bookings found in this file.");
      setFile({ bookings: r.bookings, warnings: r.warnings, fileName: name });
      setError(null);
      // Open the first booking that needs attention.
      const all = r.bookings.map((b) => analyze(b, today, hs));
      onFileChecked(all, name);
      const first = all.find((a) => a.status !== "ready") ?? null;
      setSelected(first?.booking.id ?? r.bookings[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read this file. Is it a Preflight booking workbook (.xlsx)?");
    }
  }
  const onFile = async (f: File | undefined) => f && load(await f.arrayBuffer(), f.name);
  const loadSample = async () => load(await (await fetch(SAMPLE)).arrayBuffer(), "ShipCheck_sample_bookings.xlsx");
  const patch = (id: string, p: Patch[]) => setFile((f) => ({ ...f, bookings: f.bookings.map((b) => (b.id === id ? applyPatches(b, p) : b)) }));

  const k = {
    total: analyses.length,
    ready: analyses.filter((a) => a.status === "ready").length,
    review: analyses.filter((a) => a.status === "review").length,
    blocked: analyses.filter((a) => a.status === "blocked").length,
    red: analyses.reduce((s, a) => s + a.counts.red, 0),
    amber: analyses.reduce((s, a) => s + a.counts.amber, 0),
  };

  if (!bookings.length)
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">Bulk check</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Check a file of bookings</h1>
        <p className="mt-1 text-slate-600">Upload the Bookings + Items workbook. Every booking runs through 11 pre-flight checks, gets a carrier pick for its priority, and you can fix issues in place.</p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
          onClick={() => input.current?.click()}
          className={cx("mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-white p-10 text-center transition", drag ? "border-brand bg-brand-soft/40" : "border-slate-300 hover:border-brand/60")}
        >
          <Upload className="h-8 w-8 text-brand" />
          <p className="mt-2 font-medium">Drop your .xlsx here, or click to choose</p>
          <p className="text-sm text-slate-500">Sheets &quot;Bookings&quot; and &quot;Items&quot; in the Preflight booking template. Nothing leaves your browser.</p>
          <input ref={input} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <Button variant="secondary" onClick={loadSample}><FileSpreadsheet className="h-4 w-4" />Try the sample file (9 bookings, planted mistakes)</Button>
          <a href={SAMPLE} download className="inline-flex items-center gap-1 text-brand underline-offset-2 hover:underline"><Download className="h-4 w-4" />Download sample</a>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* List */}
      <div className="flex min-h-0 flex-col border-slate-200 lg:w-[440px] lg:shrink-0 lg:border-r">
        <div className="border-b border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">Bulk check</p>
              <p className="truncate text-sm font-medium text-ink" title={fileName ?? ""}><FileSpreadsheet className="mr-1 inline h-4 w-4 text-slate-500" />{fileName}</p>
            </div>
            <Button variant="ghost" onClick={() => { setFile(EMPTY_FILE); setSelected(null); }}>New file</Button>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[["Bookings", k.total, "text-ink"], ["Ready", k.ready, "text-emerald-700"], ["Review", k.review, "text-amber-700"], ["Blocked", k.blocked, "text-red-700"]].map(([l, v, c]) => (
              <div key={l as string} className="rounded-lg bg-white py-2 ring-1 ring-inset ring-slate-200">
                <p className={cx("text-xl font-semibold tabular-nums", c as string)}>{v}</p>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">{l}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs tabular-nums text-slate-500">{k.red} must-fix and {k.amber} warnings found across the file.</p>
          <div className="mt-3">
            <RouteMap
              height={150}
              selected={selected}
              onSelect={setSelected}
              lanes={analyses.map((a) => ({ id: a.booking.id, origin: a.booking.originCity, dest: a.booking.destCity, status: a.status, label: `${a.booking.id} · ${a.booking.sellerName}` }))}
            />
          </div>
          {warnings.length > 0 && (
            <details className="mt-2 text-xs text-slate-600">
              <summary className="cursor-pointer">{warnings.length} note{warnings.length > 1 ? "s" : ""} about the file</summary>
              <ul className="mt-1 list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </details>
          )}
        </div>
        <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto bg-white scroll-thin max-lg:max-h-[40vh]">
          {analyses.map((a) => {
            const b = a.booking;
            const c = a.recommendation.chosen;
            return (
              <li key={b.id}>
                <button onClick={() => setSelected(b.id)} className={cx("w-full px-4 py-3 text-left transition hover:bg-slate-50", selected === b.id && "bg-brand-soft/40 shadow-[inset_3px_0_0_var(--color-brand)]")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-700">{b.id}</span>
                    {confirmed[b.id] ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Booked</span> : <StatusPill status={a.status} short />}
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{b.sellerName}</p>
                  <p className="truncate text-xs tabular-nums text-slate-500">{b.originCity} → {b.destCity} · {b.priority ?? "no priority"} · {b.pallets ?? "?"} pallets</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {a.counts.red > 0 && <SevChip s="red">{a.counts.red}</SevChip>}
                    {a.counts.amber > 0 && <SevChip s="amber">{a.counts.amber}</SevChip>}
                    {[...new Set(a.issues.filter((i) => i.severity !== "info").map((i) => ruleName(i.rule)))].map((r) => <span key={r} className="text-[10px] text-slate-500">{r}</span>)}
                    <span className="ml-auto text-xs tabular-nums text-slate-600">{c ? `${c.option.carrier.replace("Carrier ", "")} · ${gbp(c.freight)}` : "no carrier"}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Detail */}
      <div className="min-h-0 flex-1">
        {current ? (
          <BookingPanel
            key={current.booking.id}
            analysis={current}
            today={today}
            hs={hs}
            onPatch={(p) => patch(current.booking.id, p)}
            onConfirm={() => onConfirm(current)}
            onDocs={(kind) => onDocs(current, kind)}
            onShare={() => onShare(current)}
          />
        ) : (
          <p className="p-6 text-slate-500">Select a booking.</p>
        )}
      </div>
    </div>
  );
}
