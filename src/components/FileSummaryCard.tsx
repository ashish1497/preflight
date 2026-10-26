"use client";
import { ChevronRight, FileSpreadsheet } from "lucide-react";
import type { FileSummary } from "@/lib/types";
import { Button, cx } from "./ui";

/** "12 KB", "1.4 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** The file a seller attached, shown inside their chat bubble. */
export function FileChip({ name, size, className }: { name: string; size: number; className?: string }) {
  return (
    <span className={cx("inline-flex max-w-full items-center gap-2 rounded-lg bg-white/15 px-2.5 py-1.5 ring-1 ring-inset ring-white/25", className)}>
      <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate font-medium">{name}</span>
      <span className="shrink-0 text-xs tabular-nums opacity-80">{formatBytes(size)}</span>
    </span>
  );
}

const COUNTS = [
  { key: "ready", label: "Ready", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-600" },
  { key: "review", label: "Review", tone: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  { key: "blocked", label: "Blocked", tone: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-600" },
] as const;

/** Result of a bookings file checked in chat: counts, the bookings that need attention, and a way into Bulk check. */
export function FileSummaryCard({ summary, onOpenBulk }: { summary: FileSummary; onOpenBulk?: (id?: string) => void }) {
  const { fileName, total, top } = summary;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(11,31,58,0.10)]" aria-label={`Check results for ${fileName}`}>
      <header className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900" title={fileName}>{fileName}</p>
          <p className="text-xs text-slate-500">
            <span className="tabular-nums">{total}</span> {total === 1 ? "booking" : "bookings"} checked
          </p>
        </div>
      </header>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {COUNTS.map((c) => (
          <div key={c.key} className={cx("rounded-lg px-2.5 py-2 ring-1 ring-inset", c.tone)}>
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
              <span className={cx("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden />
              {c.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{summary[c.key]}</dd>
          </div>
        ))}
      </dl>

      {top.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Needs attention</p>
          <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {top.slice(0, 3).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={!onOpenBulk}
                  onClick={() => onOpenBulk?.(t.id)}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                  aria-label={`Open ${t.id} (${t.seller}): ${t.issue}`}
                >
                  <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-slate-700">{t.id}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">{t.seller || "Unnamed seller"}</span>
                    <span className="block truncate text-xs text-slate-500">{t.issue}</span>
                  </span>
                  {onOpenBulk && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-emerald-700">Every booking in this file passed its checks.</p>
      )}

      {onOpenBulk && (
        <Button className="mt-3 w-full" onClick={() => onOpenBulk()}>
          Review in Bulk check
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </section>
  );
}
