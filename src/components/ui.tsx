"use client";
import { useEffect, useState } from "react";
import type { HsLookup } from "@/lib/hs";
import type { Severity, Status } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const SEV = {
  red: { dot: "bg-red-500", chip: "bg-red-50 text-red-700 ring-red-200", label: "Must fix" },
  amber: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "Check" },
  info: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200", label: "Note" },
};

export function SevChip({ s, children }: { s: Severity; children?: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", SEV[s].chip)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", SEV[s].dot)} />
      {children ?? SEV[s].label}
    </span>
  );
}

const STATUS = {
  blocked: { cls: "bg-red-700 text-white", label: "Blocked: fix before booking" },
  review: { cls: "bg-amber-700 text-white", label: "Review warnings" },
  ready: { cls: "bg-emerald-700 text-white", label: "Ready to book" },
};

export function StatusPill({ status, short }: { status: Status; short?: boolean }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", STATUS[status].cls)}>
      {short ? { blocked: "Blocked", review: "Review", ready: "Ready" }[status] : STATUS[status].label}
    </span>
  );
}

export function Card({ title, right, children, className }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(11,31,58,0.10)]", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 border-l-4 border-l-brand bg-panel px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({ variant = "primary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "fix" }) {
  const v = {
    primary: "bg-brand text-white hover:bg-brand-hover disabled:bg-slate-300",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100",
    fix: "bg-brand-soft/60 text-brand ring-1 ring-inset ring-brand/30 hover:bg-brand-soft",
  }[variant];
  return <button {...p} className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed", v, className)} />;
}

/** Square icon-only button (mic, attach, send). Always pass an aria-label. */
export function IconButton({ className, active, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        className,
      )}
    />
  );
}

/** Small neutral or brand label. */
export function Chip({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "brand" | "ai"; className?: string }) {
  const t = { neutral: "bg-slate-100 text-slate-700", brand: "bg-brand-soft text-brand", ai: "bg-ai-soft text-ai" }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", t, className)}>{children}</span>;
}

/** The five field states (docs/execution-plan.md §2.2). */
export type FieldState = "missing" | "suggested" | "verified" | "warning" | "error" | "plain";
export function fieldStateClass(state: FieldState): string {
  return {
    missing: "border-dashed border-amber-400 bg-amber-50/40",
    suggested: "border-ai/40 bg-ai-soft/40",
    verified: "border-slate-200",
    warning: "border-amber-500 bg-amber-50",
    error: "border-red-500 bg-red-50",
    plain: "border-slate-200",
  }[state];
}

/** Pre-flight progress meter: passed / total checks. */
export function Meter({ passed, total, label = "Pre-flight" }: { passed: number; total: number; label?: string }) {
  const pct = total ? Math.round((passed / total) * 100) : 0;
  const tone = passed === total ? "bg-emerald-600" : pct >= 70 ? "bg-brand" : "bg-amber-500";
  return (
    <div className="flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={passed} aria-label={`${label} ${passed} of ${total} checks passed`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200"><span className={cx("block h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} /></span>
      <span className="text-xs font-semibold tabular-nums text-slate-700">{passed}/{total}</span>
    </div>
  );
}

let hsCache: Promise<HsLookup> | null = null;
export function useHs(): HsLookup | null {
  const [hs, setHs] = useState<HsLookup | null>(null);
  useEffect(() => {
    hsCache ??= fetch("/data/hs.json").then((r) => r.json());
    hsCache.then(setHs).catch(() => setHs(null));
  }, []);
  return hs;
}
