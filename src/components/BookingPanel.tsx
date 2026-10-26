"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { collectionDate, gbp } from "@/lib/carriers";
import { formatDate, formatDateLong } from "@/lib/dates";
import { roadKm } from "@/lib/geo";
import {
  AlertTriangle, Bell, Boxes, CalendarDays, Check, CheckCircle2, ChevronDown, CircleSlash, FileText, Info, MapPin, Package, ShieldCheck, Truck, Wrench,
} from "lucide-react";
import { describeHs, normalizeHs, type HsLookup } from "@/lib/hs";
import { documentChecklist } from "@/lib/confirm";
import { DEST_CITIES, ORIGIN_CITIES, ORIGIN_COUNTRIES_OF_GOODS, PRIORITIES, effectiveIncoterm, ruleName } from "@/lib/reference";
import { fieldIssues, itemKey, messageFor, meter, sectionStatus, stateFor, type FieldKey, type SectionId } from "@/lib/fieldStatus";
import type { Analysis, Booking, Issue, Item, Patch } from "@/lib/types";
import { ComplianceChecklist } from "./Checklist";
import { CustomsCard } from "./Customs";
import { Button, Card, cx, fieldStateClass, Meter, SevChip, StatusPill, type FieldState } from "./ui";

type Props = {
  analysis: Analysis;
  today: string;
  hs: HsLookup | null;
  onPatch: (p: Patch[]) => void;
  onConfirm: () => void;
  onDocs: (kind: "invoice" | "packing") => void;
  onShare?: () => void;
  derived?: { cartons: boolean; declaredValue: boolean };
  /** Field names that just changed (for a highlight flash in chat mode). */
  changed?: string[];
};

const fmtN = (n: number | null | undefined) => (n == null ? "" : String(n));
const toNum = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? null : Number(s));
const nf = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const cityCode = (city: string) => (city ? city.slice(0, 3).toUpperCase() : "???");
const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n: number | null | undefined, word: string) => `${n ?? "?"} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- fields
function FieldMessage({ state, issue }: { state: FieldState; issue?: Issue }) {
  if (!issue) return null;
  return (
    <p className={cx("mt-0.5 line-clamp-2 text-[11px] leading-snug", state === "error" ? "text-red-700" : "text-amber-800")} title={issue.title}>
      {issue.title}
    </p>
  );
}

function Field({ label, value, onCommit, type = "text", options, hint, flash, suffix, state = "plain", issue }: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  type?: "text" | "number" | "date" | "select";
  options?: string[];
  hint?: string;
  flash?: boolean;
  suffix?: string;
  state?: FieldState;
  issue?: Issue;
}) {
  const base = cx(
    "w-full rounded-lg border px-2 py-1 text-sm text-slate-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20",
    fieldStateClass(state),
    state === "verified" || state === "plain" ? "bg-white" : null,
    type === "number" && "tabular-nums",
    flash && "ring-2 ring-ai/50",
  );
  const tick = state === "verified" && <Check aria-label="Checked" className={cx("pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-700", type === "select" ? "right-6" : suffix ? "right-6" : "right-2")} />;
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
        {hint && <span className={cx("normal-case tracking-normal", state === "suggested" ? "text-ai" : "text-slate-400")}>· {hint}</span>}
      </span>
      <div className="relative">
        {type === "select" ? (
          <select className={cx(base, "pr-6")} value={value} onChange={(e) => onCommit(e.target.value)} aria-invalid={state === "error" || undefined}>
            <option value="">—</option>
            {options!.map((o) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input
            key={value}
            className={cx(base, (suffix || state === "verified") && "pr-8", suffix && state === "verified" && "pr-11")}
            type={type}
            inputMode={type === "number" ? "decimal" : undefined}
            defaultValue={value}
            aria-invalid={state === "error" || undefined}
            onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        )}
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
        {tick}
      </div>
      <FieldMessage state={state} issue={issue} />
    </label>
  );
}

// ---------------------------------------------------------------- issues (compact list)
function IssueRow({ issue, onPatch }: { issue: Issue; onPatch: Props["onPatch"] }) {
  const Icon = issue.severity === "red" ? CircleSlash : issue.severity === "amber" ? AlertTriangle : Info;
  return (
    <li className="flex items-start gap-2.5 py-2">
      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", issue.severity === "red" ? "text-red-700" : issue.severity === "amber" ? "text-amber-700" : "text-sky-700")} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{ruleName(issue.rule)}</span>
          <span className="font-medium text-slate-900">{issue.title}</span>
          {issue.rule === "D-01" && <span className="ml-1.5 text-[11px] text-slate-500">advisory</span>}
        </p>
        <details className="group mt-0.5 text-xs text-slate-600">
          <summary className="cursor-pointer list-none text-slate-500 hover:text-slate-700">
            <span className="group-open:hidden">Why and how to fix ›</span><span className="hidden group-open:inline">Hide details</span>
          </summary>
          <p className="mt-1">{issue.detail}</p>
          <p className="mt-1 flex gap-1.5 text-slate-800">
            <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
            <span><span className="font-medium">How to fix:</span> {issue.fix}</span>
          </p>
        </details>
        {issue.quickFixes && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {issue.quickFixes.map((f) => (
              <Button key={f.label} variant="fix" className="px-2 py-0.5 text-xs tabular-nums" onClick={() => onPatch(f.patches)}>Apply: {f.label}</Button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- carrier
function CarrierCard({ a }: { a: Analysis }) {
  const r = a.recommendation;
  const balanced = (a.booking.priority ?? "Balanced") === "Balanced";
  return (
    <Card title={<span className="flex items-center gap-2"><Truck className="h-4 w-4 text-slate-500" />Recommended carrier</span>} right={<span className="text-xs text-slate-500">Priority: <b className="text-slate-700">{a.booking.priority ?? "Balanced (default)"}</b>{a.booking.neededBy && <> · needed by <b className="tabular-nums">{formatDate(a.booking.neededBy)}</b></>}</span>}>
      {r.chosen ? (
        <div className="mb-3 rounded-lg bg-brand-soft/40 p-3 ring-1 ring-inset ring-brand/25">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-base font-semibold text-slate-900">{r.chosen.option.carrier} · {r.chosen.option.service}</p>
            <p className="text-sm tabular-nums text-slate-800"><b>{gbp(r.chosen.freight)}</b> · {r.chosen.option.transitDays} working days · arrives <b>{formatDate(r.chosen.eta)}</b></p>
          </div>
          <p className="mt-1 text-sm text-slate-700">{r.reason}</p>
          {r.runnerUp && <p className="mt-1 text-xs text-slate-500">Next best: {r.runnerUp.tradeOff}</p>}
        </div>
      ) : (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{r.reason}</p>
      )}
      {r.evals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Service</th>
                <th className="px-2 font-medium">Price</th>
                <th className="px-2 font-medium">Transit</th>
                <th className="px-2 font-medium">On-time</th>
                <th className="px-2 font-medium">Max/pallet</th>
                <th className="px-2 font-medium">Arrives</th>
                <th className={cx("px-2 font-medium", !balanced && "hidden sm:table-cell")} title="Freight + goods value × 0.1%/day in transit + late-delivery risk">Total cost*</th>
              </tr>
            </thead>
            <tbody>
              {r.evals.map((e) => {
                const chosen = r.chosen === e;
                return (
                  <tr key={e.option.carrier} className={cx("border-t border-slate-100", chosen && "bg-brand-soft/30 font-medium", !e.eligible && "text-slate-400")}>
                    <td className="py-1.5 pr-2">
                      {e.option.carrier} <span className="text-slate-500">{e.option.service.replace("Road ", "")}</span>
                      {chosen && <span className="ml-1 rounded bg-brand px-1 text-[10px] text-white">PICK</span>}
                    </td>
                    <td className="px-2">{gbp(e.freight)}</td>
                    <td className="px-2">{e.option.transitDays}d</td>
                    <td className="px-2">{e.option.onTimeRate}%</td>
                    <td className={cx("px-2", !e.fitsWeight && "text-red-700")}>{e.option.maxWeightPerPallet} kg</td>
                    <td className={cx("px-2", !e.meetsDeadline && "text-red-700")}>{formatDate(e.eta)}</td>
                    <td className={cx("px-2", !balanced && "hidden sm:table-cell")}>{gbp(e.effectiveCost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {a.computed.weightPerPallet != null && <p className="mt-2 text-xs text-slate-500">Your load: <span className="tabular-nums">{Math.round(a.computed.weightPerPallet)} kg per pallet ({a.booking.grossWeight} kg ÷ {a.booking.pallets})</span>. *Total cost = freight + goods value × 0.1% per day in transit + chance of late arrival × £{a.booking.destType === "Warehouse" && a.booking.appointment ? 150 : 50} (missed slot / rebooking). Used for Balanced.</p>}
        </div>
      )}
      {r.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {r.notes.map((n) => <li key={n} className="flex gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />{n}</li>)}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- items
const CELL = "w-full rounded-md border px-1 py-0.5 text-sm outline-none focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20";

function NumCell({ value, state, issue, width, onCommit }: { value: number | null; state: FieldState; issue?: Issue; width: string; onCommit: (v: number | null) => void }) {
  const v = fmtN(value);
  return (
    <input
      key={v}
      defaultValue={v}
      inputMode="decimal"
      aria-invalid={state === "error" || undefined}
      title={issue?.title}
      className={cx(CELL, width, "tabular-nums", fieldStateClass(state), (state === "verified" || state === "plain") && "bg-white")}
      onBlur={(e) => e.target.value !== v && onCommit(toNum(e.target.value))}
    />
  );
}

function ItemsTable({ a, hs, onPatch }: { a: Analysis; hs: HsLookup | null; onPatch: Props["onPatch"] }) {
  const b = a.booking;
  const set = (index: number, field: keyof Item, value: unknown) => onPatch([{ kind: "item", index, field, value }]);
  const st = (i: number, f: keyof Item, opts?: { suggested?: boolean }) => {
    const key = itemKey(i, f);
    const state = stateFor(key, b.items[i][f], a, opts);
    return { state, issue: messageFor(key, a, state) };
  };
  const blankItem: Item = { sku: `ITEM-${String(b.items.length + 1).padStart(2, "0")}`, description: "", hsCode: null, quantity: null, unitPrice: null, unitsPerCarton: null, cartons: null, unitWeight: null, countryOfOrigin: null };
  const add = <Button variant="ghost" className="mt-1" onClick={() => onPatch([{ kind: "booking", field: "items", value: [...b.items, blankItem] }])}>+ Add product</Button>;
  if (!b.items.length) return <div><p className="text-sm text-slate-500">No products yet.</p>{add}</div>;
  const issues = fieldIssues(a);
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1 pr-1 font-medium">Product</th>
            <th className="px-1 font-medium">HS code</th>
            <th className="px-1 font-medium">Qty</th>
            <th className="px-1 font-medium">£/unit</th>
            <th className="px-1 font-medium">/carton</th>
            <th className="px-1 font-medium">Cartons</th>
            <th className="px-1 font-medium">kg/unit</th>
            <th className="px-1 font-medium">Made in</th>
          </tr>
        </thead>
        <tbody>
          {b.items.map((it, i) => {
            const info = describeHs(it.hsCode, hs);
            const desc = st(i, "description");
            const hsS = st(i, "hsCode", { suggested: it.hsSuggested });
            const coo = st(i, "countryOfOrigin");
            // Distinct red/amber issues on this row, shown once under the row.
            const rowIssues = [...new Set((Object.keys(it) as (keyof Item)[]).flatMap((f) => issues.get(itemKey(i, f)) ?? []))]
              .filter((x) => x.severity !== "info")
              .sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "red" ? -1 : 1));
            const num = (f: keyof Item, w: string) => {
              const s = st(i, f);
              return <NumCell value={it[f] as number | null} state={s.state} issue={s.issue} width={w} onCommit={(v) => set(i, f, v)} />;
            };
            return (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="py-1 pr-1">
                  <input key={it.description} defaultValue={it.description} title={desc.issue?.title} aria-invalid={desc.state === "error" || undefined} className={cx(CELL, "font-medium", fieldStateClass(desc.state), (desc.state === "verified" || desc.state === "plain") && "bg-white")} onBlur={(e) => e.target.value !== it.description && set(i, "description", e.target.value)} />
                  <span className="px-1 font-mono text-[11px] text-slate-400">{it.sku}</span>
                  {rowIssues.length > 0 && (
                    <ul className="mt-0.5 max-w-[260px] space-y-0.5 px-1">
                      {rowIssues.slice(0, 3).map((x) => (
                        <li key={x.rule + x.title} className={cx("text-[11px] leading-snug", x.severity === "red" ? "text-red-700" : "text-amber-800")}>{sentence(x.title.replace(/^[^:]+:\s*/, ""))}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-1">
                  <input key={it.hsCode ?? ""} defaultValue={it.hsCode ?? ""} title={hsS.issue?.title} aria-invalid={hsS.state === "error" || undefined} className={cx(CELL, "w-24 font-mono tabular-nums", fieldStateClass(hsS.state), (hsS.state === "verified" || hsS.state === "plain") && "bg-white")} onBlur={(e) => e.target.value !== (it.hsCode ?? "") && set(i, "hsCode", normalizeHs(e.target.value))} />
                  <p className="max-w-[180px] px-1 text-[11px] leading-tight text-slate-500" title={info.description ?? ""}>
                    {it.hsSuggested && <span className="font-medium text-ai">Suggested · </span>}
                    {info.description ? info.description.slice(0, 60) + (info.description.length > 60 ? "…" : "") : it.hsCode ? (info.matches.length ? `Not a full listed code · ${info.matches.length} match` : "Not in 2026 tariff list") : ""}
                  </p>
                </td>
                <td className="px-1">{num("quantity", "w-16")}</td>
                <td className="px-1">{num("unitPrice", "w-16")}</td>
                <td className="px-1">{num("unitsPerCarton", "w-14")}</td>
                <td className="px-1">{num("cartons", "w-14")}</td>
                <td className="px-1">{num("unitWeight", "w-14")}</td>
                <td className="px-1">
                  <select value={it.countryOfOrigin ?? ""} title={coo.issue?.title} onChange={(e) => set(i, "countryOfOrigin", e.target.value || null)} className={cx(CELL, "w-28", fieldStateClass(coo.state), (coo.state === "verified" || coo.state === "plain") && "bg-white")}>
                    <option value="">—</option>
                    {ORIGIN_COUNTRIES_OF_GOODS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {add}
    </div>
  );
}

// ---------------------------------------------------------------- route
const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false, loading: () => <div className="h-[200px] animate-pulse rounded-xl bg-slate-100" /> });

function RouteCard({ a, today }: { a: Analysis; today: string }) {
  const b = a.booking;
  const c = a.recommendation.chosen;
  const km = roadKm(b.originCity, b.destCity);
  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-xs tabular-nums text-slate-500">{sub}</p>}
    </div>
  );
  return (
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(11,31,58,0.10)] md:grid-cols-[1fr_200px]">
      <RouteMap lanes={[{ id: b.id, origin: b.originCity, dest: b.destCity, status: a.status }]} height={200} />
      <div className="grid grid-cols-2 content-start gap-3 md:grid-cols-1">
        {stat("Route", `${b.originCity} → ${b.destCity}`, km ? `~${km.toLocaleString("en-GB")} km by road via Dover–Calais` : undefined)}
        {stat("Collection", formatDateLong(collectionDate(b, today)))}
        {stat("Delivery (est.)", c ? formatDateLong(c.eta) : "—", c ? `${c.option.carrier} · ${c.option.transitDays} working days` : "No carrier yet")}
        {stat("Load", `${b.pallets ?? "?"} pallets · ${b.grossWeight ?? "?"} kg`, a.computed.weightPerPallet ? `${Math.round(a.computed.weightPerPallet)} kg per pallet` : undefined)}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- sheet sections
type Badge = { red: number; amber: number; missing: number; note?: string };

function SectionBadge({ red, amber, missing, note }: Badge) {
  if (red) return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium tabular-nums text-red-700 ring-1 ring-inset ring-red-200"><CircleSlash className="h-3 w-3" />{red} to fix</span>;
  if (amber) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-800 ring-1 ring-inset ring-amber-200"><AlertTriangle className="h-3 w-3" />{amber} to check</span>;
  if (missing) return <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-800">{missing} missing</span>;
  if (note) return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{note}</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200" aria-label="All checks passed"><Check className="h-3 w-3" />OK</span>;
}

function SheetSection({ id, title, icon: Icon, badge, summary, open, onToggle, flash, children }: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: Badge;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  flash?: boolean;
  children: React.ReactNode;
}) {
  const bodyId = `sheet-${id}`;
  return (
    <section className={cx("overflow-hidden rounded-xl border bg-white shadow-[0_1px_3px_rgba(11,31,58,0.10)] transition", badge.red ? "border-red-300" : badge.amber ? "border-amber-300" : "border-slate-200", flash && "ring-2 ring-ai/40")}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} className={cx("flex w-full items-center gap-2 border-l-4 bg-panel px-4 py-2.5 text-left hover:bg-slate-100", badge.red ? "border-l-red-600" : badge.amber ? "border-l-amber-600" : "border-l-brand")}>
        <ChevronDown className={cx("h-4 w-4 shrink-0 text-slate-400 transition-transform", !open && "-rotate-90")} />
        <Icon className="h-4 w-4 shrink-0 text-brand" />
        <span className="shrink-0 text-sm font-semibold text-ink">{title}</span>
        <span className={cx("min-w-0 flex-1 truncate text-sm tabular-nums text-slate-500", open && "invisible")}>{summary}</span>
        <SectionBadge {...badge} />
      </button>
      {open && <div id={bodyId} className="border-t border-slate-200 p-4">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------- panel
export function BookingPanel({ analysis: a, today, hs, onPatch, onConfirm, onDocs, onShare, derived, changed = [] }: Props) {
  const b = a.booking;
  // The acknowledgement only holds for the exact set of warnings the seller saw.
  const ackKey = `${b.id}|${a.issues.map((i) => i.rule + i.title).join("|")}`;
  const [ackFor, setAckFor] = useState<string | null>(null);
  const ack = ackFor === ackKey;
  const setAck = (v: boolean) => setAckFor(v ? ackKey : null);
  const set = (field: keyof Booking, value: unknown) => onPatch([{ kind: "booking", field, value }]);
  const red = a.issues.filter((i) => i.severity === "red");
  const amber = a.issues.filter((i) => i.severity === "amber");
  const info = a.issues.filter((i) => i.severity === "info");
  const docs = documentChecklist(a);
  const fl = (f: string) => changed.includes(f);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const blank = b.id === "NEW" && !b.items.length && !b.originCity && !b.destCity;
  const m = meter(a);

  // Field state + inline message for a booking-level field.
  const fs = (key: FieldKey & keyof Booking, opts?: { suggested?: boolean; required?: boolean }) => {
    const state = stateFor(key, b[key], a, opts);
    return { state, issue: messageFor(key, a, state) };
  };

  // Sections open automatically while they have something to fix; a manual toggle holds until that changes.
  const [overrides, setOverrides] = useState<Record<string, { open: boolean; sig: string }>>({});
  const section = (id: SectionId | "customs", badge: Badge, auto: boolean) => {
    const sig = `${badge.red}|${badge.amber}|${badge.missing}|${id === "customs" ? "" : sectionStatus(a, id).red.concat(sectionStatus(a, id).amber).map((i) => i.title).join("|")}`;
    const o = overrides[id];
    const open = o && o.sig === sig ? o.open : auto;
    return { open, badge, onToggle: () => setOverrides((s) => ({ ...s, [id]: { open: !open, sig } })) };
  };
  const badgeOf = (id: SectionId): Badge => {
    const s = sectionStatus(a, id);
    return { red: s.red.length, amber: s.amber.length, missing: s.missing.length };
  };
  const sec = (id: SectionId) => {
    const badge = badgeOf(id);
    return section(id, badge, !!(badge.red || badge.amber || badge.missing));
  };
  const route = sec("route"), goods = sec("goods"), load = sec("load"), dates = sec("dates");
  const docsTodo = docs.neededFromYou.filter((d) => !d.done).length;
  const docsErr = docs.neededFromYou.filter((d) => d.error).length;
  const customs = section("customs", { red: 0, amber: docsErr, missing: 0, note: docsTodo ? `${docsTodo} to add` : undefined }, true);

  const fromName = b.originCity ? `${b.originCity}, UK` : "Origin?";
  const toName = b.destCity ? `${b.destCity}${b.destCountry ? `, ${b.destCountry}` : ""}` : "Destination?";
  const units = b.items.reduce((s, it) => s + (it.quantity ?? 0), 0);

  const sp = { seller: fs("sellerName"), origin: fs("originCity"), dest: fs("destCity"), site: fs("destType") };
  const ld = { pallets: fs("pallets"), cartons: fs("cartons", { suggested: derived?.cartons }), value: fs("declaredValue", { suggested: derived?.declaredValue }), weight: fs("grossWeight") };
  const dt = { ready: fs("readyDate"), needed: fs("neededBy"), priority: fs("priority"), incoterm: fs("incoterm"), slot: fs("appointment", { required: b.destType === "Warehouse" }) };

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 space-y-3 overflow-y-auto p-4 scroll-thin">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-500">{b.id === "NEW" ? "New booking" : b.id}{b.sellerName && (b.originCity || b.destCity) && <span className="font-sans"> · {b.sellerName}</span>}</p>
            {b.originCity || b.destCity ? (
              <h2 className="flex items-baseline gap-2 font-mono text-xl font-semibold tracking-wide text-ink" aria-label={`${b.originCity || "Origin unknown"} to ${b.destCity || "destination unknown"}`}>
                <span>{cityCode(b.originCity)}</span>
                <span className="text-slate-400" aria-hidden>→</span>
                <span>{cityCode(b.destCity)}</span>
              </h2>
            ) : (
              <h2 className="text-lg font-semibold text-ink">{b.sellerName || "New booking"}</h2>
            )}
            <p className="text-sm text-slate-600">{fromName} → {toName} · {b.destType ?? "site type?"}</p>
          </div>
          <div className={cx("flex flex-col items-end gap-1.5", blank && "hidden")}>
            <StatusPill status={a.status} />
            <Meter passed={m.passed} total={m.total} />
            {onShare && <button onClick={onShare} className="flex items-center gap-1 text-xs text-brand hover:underline"><Bell className="h-3 w-3" />Send checks to my email / Telegram</button>}
          </div>
        </div>

        {blank && (
          <div className="rounded-xl border border-dashed border-ai/40 bg-ai-soft/60 p-4 text-sm text-slate-800">
            <p className="font-medium text-ai">Your booking builds here as you chat.</p>
            <p className="mt-1 text-slate-600">Every message updates the sections below and re-runs all 11 pre-flight checks and the carrier pick. Dashed fields are still missing. You can also type into them directly.</p>
          </div>
        )}

        {/* Compact issue list */}
        {!blank && (
          <Card title="Pre-flight checks" right={<span className="flex gap-1.5"><SevChip s="red"><span className="tabular-nums">{a.counts.red}</span> must fix</SevChip><SevChip s="amber"><span className="tabular-nums">{a.counts.amber}</span> to check</SevChip></span>} className="[&>div]:py-1">
            {a.issues.length === 0 ? (
              <p className="flex items-center gap-2 py-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />All 11 checks passed: counts, value, weight, HS codes, restricted goods, appointment and dates.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...red, ...amber, ...info].map((i, k) => <IssueRow key={i.rule + k + i.title} issue={i} onPatch={onPatch} />)}
              </ul>
            )}
          </Card>
        )}

        {/* Route */}
        <SheetSection id="route" title="Route" icon={MapPin} {...route} flash={["originCity", "destCity", "destType"].some(fl)}
          summary={`${b.originCity || "?"} → ${b.destCity || "?"} · ${b.destType ?? "site type?"}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Seller" value={b.sellerName} onCommit={(v) => set("sellerName", v)} flash={fl("sellerName")} {...sp.seller} />
            <Field label="From" type="select" options={ORIGIN_CITIES} value={b.originCity} onCommit={(v) => set("originCity", v)} flash={fl("originCity")} {...sp.origin} />
            <Field label="To" type="select" options={Object.keys(DEST_CITIES)} value={b.destCity} onCommit={(v) => onPatch([{ kind: "booking", field: "destCity", value: v }, { kind: "booking", field: "destCountry", value: DEST_CITIES[v] ?? "" }])} flash={fl("destCity")} {...sp.dest} />
            <Field label="Site type" type="select" options={["Warehouse", "Business address"]} value={b.destType ?? ""} onCommit={(v) => set("destType", v || null)} flash={fl("destType")} {...sp.site} />
          </div>
        </SheetSection>

        {/* Goods */}
        <SheetSection id="goods" title="Goods" icon={Package} {...goods} flash={fl("items")}
          summary={b.items.length ? `${b.items.length} product${b.items.length > 1 ? "s" : ""} · ${nf(units)} units · ${gbp(a.computed.itemsValue)}` : "No products yet"}>
          <ItemsTable a={a} hs={hs} onPatch={onPatch} />
        </SheetSection>

        {/* Load */}
        <SheetSection id="load" title="Load" icon={Boxes} {...load} flash={["pallets", "cartons", "declaredValue", "grossWeight"].some(fl)}
          summary={`${plural(b.pallets, "pallet")} · ${plural(b.cartons, "carton")} · ${b.declaredValue != null ? gbp(b.declaredValue) : "£?"} · ${b.grossWeight ?? "?"} kg`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Pallets" type="number" value={fmtN(b.pallets)} onCommit={(v) => set("pallets", toNum(v))} flash={fl("pallets")} {...ld.pallets} />
            <Field label="Cartons" type="number" value={fmtN(b.cartons)} onCommit={(v) => set("cartons", toNum(v))} hint={derived?.cartons ? "calculated" : undefined} flash={fl("cartons")} {...ld.cartons} />
            <Field label="Declared value" type="number" value={fmtN(b.declaredValue)} onCommit={(v) => set("declaredValue", toNum(v))} hint={derived?.declaredValue ? "calculated" : undefined} suffix="£" flash={fl("declaredValue")} {...ld.value} />
            <Field label="Gross weight" type="number" value={fmtN(b.grossWeight)} onCommit={(v) => set("grossWeight", toNum(v))} suffix="kg" flash={fl("grossWeight")} {...ld.weight} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-slate-500">
            <span>Items total: <b className="text-slate-700">{gbp(a.computed.itemsValue)}</b></span>
            <span>Item cartons: <b className="text-slate-700">{a.computed.itemsCartons}</b></span>
            <span>Goods weight: <b className="text-slate-700">{Math.round(a.computed.netWeight * 10) / 10} kg</b></span>
            {a.computed.weightPerPallet != null && <span>Per pallet: <b className="text-slate-700">{Math.round(a.computed.weightPerPallet)} kg</b></span>}
          </div>
        </SheetSection>

        {/* Dates & priority */}
        <SheetSection id="dates" title="Dates & priority" icon={CalendarDays} {...dates} flash={["readyDate", "neededBy", "priority", "appointment", "incoterm"].some(fl)}
          summary={[`Ready ${b.readyDate ? formatDateLong(b.readyDate) : "?"}`, b.neededBy && `by ${formatDateLong(b.neededBy)}`, b.priority ?? "Balanced", effectiveIncoterm(b).term, b.destType === "Warehouse" ? (b.appointment ? "slot booked" : "no slot") : null].filter(Boolean).join(" · ")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="Ready date" type="date" value={b.readyDate ?? ""} onCommit={(v) => set("readyDate", v || null)} flash={fl("readyDate")} {...dt.ready} />
            <Field label="Needed by" type="date" value={b.neededBy ?? ""} onCommit={(v) => set("neededBy", v || null)} hint="optional" flash={fl("neededBy")} {...dt.needed} />
            <Field label="Priority" type="select" options={PRIORITIES} value={b.priority ?? ""} onCommit={(v) => set("priority", v || null)} flash={fl("priority")} {...dt.priority} />
            <Field label="Incoterm" type="select" options={["DAP", "DDP"]} value={b.incoterm ?? ""} onCommit={(v) => set("incoterm", v || null)} hint={b.incoterm ? (b.incoterm === "DDP" ? "you pay duty" : "receiver pays duty") : `default ${effectiveIncoterm(b).term}`} flash={fl("incoterm")} {...dt.incoterm} />
            <Field label="Slot booked" type="select" options={["Yes", "No"]} value={b.appointment == null ? "" : b.appointment ? "Yes" : "No"} onCommit={(v) => set("appointment", v === "" ? null : v === "Yes")} flash={fl("appointment")} {...dt.slot} />
          </div>
        </SheetSection>

        {/* Customs & documents */}
        <SheetSection id="customs" title="Customs & documents" icon={ShieldCheck} {...customs}
          summary={docsTodo ? `${docsTodo} document detail${docsTodo > 1 ? "s" : ""} needed from you` : "Documents ready"}>
          <div className="space-y-4">
            {!blank && <ComplianceChecklist analysis={a} hs={hs} onPatch={onPatch} />}
            {!blank && <CustomsCard b={b} hs={hs} />}
            <Card title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" />Documents</span>} right={<span className="text-xs text-slate-500">Advisory · never blocks</span>}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">We generate</p>
                  <ul className="space-y-1.5">
                    {docs.generated.map((d) => (
                      <li key={d.name} className="flex gap-2 text-sm">
                        {d.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                        <span><b className="font-medium">{d.name}</b> <span className="text-slate-500">· {d.note}</span></span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <Button variant="secondary" onClick={() => onDocs("invoice")}>Commercial invoice</Button>
                    <Button variant="secondary" onClick={() => onDocs("packing")}>Packing list</Button>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Needed from you before collection</p>
                  <ul className="space-y-1.5">
                    {docs.neededFromYou.map((d) => {
                      const isOpen = openDoc === d.key;
                      return (
                        <li key={d.key} className={cx("rounded-lg border", isOpen ? "border-brand/30 bg-brand-soft/20" : "border-transparent")}>
                          <button type="button" onClick={() => setOpenDoc(isOpen ? null : d.key)} className="flex w-full gap-2 rounded-lg p-1.5 text-left text-sm hover:bg-slate-50" aria-expanded={isOpen}>
                            <span className={cx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", d.done ? "border-emerald-600 bg-emerald-600 text-white" : d.error ? "border-red-500" : "border-slate-400")}>
                              {d.done && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <b className="font-medium">{d.name}</b> <span className="text-slate-500">· {d.note}</span>
                              {d.error && <span className="block text-xs text-red-700">{d.error}</span>}
                            </span>
                            <span className="text-xs text-brand">{isOpen ? "Close" : d.done ? "Edit" : "Add"}</span>
                          </button>
                          {isOpen && (
                            <div className="grid gap-2 px-2 pb-2 sm:grid-cols-2">
                              {d.fields.map((f) => (
                                <Field key={f.field} label={f.label} value={(b[f.field] as string | null | undefined) ?? ""} onCommit={(v) => set(f.field, v.trim() ? (f.field.endsWith("Eori") ? v.replace(/\s/g, "").toUpperCase() : v.trim()) : null)} />
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {docs.dutyNote && <p className="mt-2 text-xs text-slate-500">{docs.dutyNote}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">EORI/VAT numbers are format-checked here, not looked up in the customs registry.</p>
                </div>
              </div>
            </Card>
          </div>
        </SheetSection>

        {!blank && <CarrierCard a={a} />}
        {b.originCity && b.destCity && <RouteCard a={a} today={today} />}
      </div>

      {/* Action bar */}
      <div className={cx("no-print sticky bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur", blank && "hidden")}>
        {a.status === "blocked" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-red-700"><b className="tabular-nums">{a.counts.red || 1} issue{a.counts.red > 1 ? "s" : ""} must be fixed</b> before this shipment can be booked. It would be held at customs or rejected.</p>
            <Button disabled>Confirm booking</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {a.status === "review" ? (
              <label className="flex items-center gap-2 text-sm text-amber-800">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-4 w-4 accent-amber-600" />
                I&apos;ve checked the {a.counts.amber} warning{a.counts.amber > 1 ? "s" : ""} and want to go ahead
              </label>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Everything checks out.</p>
            )}
            <Button disabled={a.status === "review" && !ack} onClick={onConfirm} className="tabular-nums">
              Confirm booking · {a.recommendation.chosen ? gbp(a.recommendation.chosen.freight) : ""}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
