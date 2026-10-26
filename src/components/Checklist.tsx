"use client";
// Compliance checklist, rendered inside the booking sheet's "Customs & documents" section.
// Stages × owner × type × why × source, then a landed-cost estimate. Never changes the booking status.
import { CircleCheck, CircleX, ClipboardCheck, CloudOff, ExternalLink, Info, Loader2, Receipt, TriangleAlert } from "lucide-react";
import { STAGES, SOURCES, buildChecklist, landedCost, type ChecklistItem, type LandedCost, type Owner } from "@/lib/compliance";
import type { HsLookup } from "@/lib/hs";
import { INCOTERMS } from "@/lib/reference";
import type { Analysis, Patch } from "@/lib/types";
import { useTariffs } from "./useTariffs";
import { cx } from "./ui";

const money = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = (n: number) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

const OWNER_TONE: Record<Owner, string> = {
  You: "bg-brand-soft text-brand",
  Receiver: "bg-slate-100 text-slate-700",
  Carrier: "bg-slate-100 text-slate-700",
  Broker: "bg-slate-100 text-slate-700",
};

const TYPE_LABEL = { blocker: "Must fix", warning: "Warning", task: "Task", advisory: "Advisory" } as const;

function TypeIcon({ item, onToggle }: { item: ChecklistItem; onToggle?: () => void }) {
  if (item.action?.kind === "confirm" && onToggle)
    return (
      <input
        type="checkbox"
        checked={!!item.done}
        onChange={onToggle}
        aria-label={`Confirm: ${item.title}`}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-[var(--color-brand)]"
      />
    );
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  switch (item.type) {
    case "blocker": return <CircleX className={cx(cls, "text-red-700")} aria-label="Must fix" />;
    case "warning": return <TriangleAlert className={cx(cls, "text-amber-700")} aria-label="Warning" />;
    case "advisory": return <Info className={cx(cls, "text-sky-700")} aria-label="Advisory" />;
    default:
      return item.done ? <CircleCheck className={cx(cls, "text-emerald-700")} aria-label="Done" /> : <span className={cx(cls, "rounded-full border-2 border-slate-300")} aria-label="To do" />;
  }
}

function Row({ item, onToggle }: { item: ChecklistItem; onToggle?: () => void }) {
  return (
    <li className={cx("flex gap-2.5 py-2", item.done && "opacity-70")}>
      <TypeIcon item={item} onToggle={onToggle} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className={cx("text-sm font-medium text-slate-800", item.done && "text-slate-500")}>{item.title}</p>
          <span className={cx("rounded-full px-1.5 py-px text-[11px] font-medium", OWNER_TONE[item.owner])}>{item.owner}</span>
          {(item.type === "advisory" || item.type === "warning" || item.type === "blocker") && (
            <span className={cx("text-[11px] font-semibold uppercase tracking-wide", item.type === "blocker" ? "text-red-700" : item.type === "warning" ? "text-amber-800" : "text-sky-700")}>{TYPE_LABEL[item.type]}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-600">{item.why}</p>
        {item.consequence && <p className="mt-0.5 text-xs text-slate-500">{item.consequence}</p>}
        {(item.source || item.action?.kind === "confirm") && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {item.action?.kind === "confirm" && onToggle && (
              <button type="button" onClick={onToggle} className="font-medium text-brand hover:underline">
                {item.done ? "Confirmed — undo" : "I have the document / the exemption applies"}
              </button>
            )}
            {item.source && (
              <a href={item.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                {item.source.label}
                <ExternalLink className="h-3 w-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

function LandedCostBlock({ lc, dest }: { lc: LandedCost; dest: string }) {
  if (!lc.lines.length && !lc.skipped.length) return null;
  const inc = INCOTERMS[lc.payer.term];
  return (
    <section className="mt-4 rounded-lg border border-slate-200 p-3" aria-labelledby="landed-cost-h">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id="landed-cost-h" className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Receipt className="h-4 w-4 text-slate-500" aria-hidden />EU import duty and VAT</h4>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Estimate</span>
      </header>
      {lc.lines.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-2 font-medium">Item</th>
                <th className="py-1 pr-2 text-right font-medium">Customs value</th>
                <th className="py-1 pr-2 text-right font-medium">Duty</th>
                <th className="py-1 text-right font-medium">Import VAT{lc.vatRate != null ? ` ${lc.vatRate}%` : ""}</th>
              </tr>
            </thead>
            <tbody>
              {lc.lines.map((l) => (
                <tr key={l.index} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-2 text-slate-700">
                    {l.name}
                    <span className="block text-[11px] text-slate-500">{money(l.goods)} goods + {money(l.freight)} freight</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-800">{money(l.customsValue)}</td>
                  <td className="py-1.5 pr-2 text-right text-slate-800">
                    {money(l.duty)}
                    <span className="block text-[11px] text-slate-500">{l.parts.map((p) => `${rate(p.rate)} ${/anti-dumping/i.test(p.label) ? "anti-dumping" : /countervailing/i.test(p.label) ? "countervailing" : /preferential/i.test(p.label) ? "UK pref." : "standard"}`).join(" + ") || "—"}</span>
                    {l.seeTariff.length > 0 && <span className="block text-[11px] text-amber-800">+ {l.seeTariff.join("; ")} (see tariff)</span>}
                  </td>
                  <td className="py-1.5 text-right text-slate-800">{lc.vatRate != null ? money(l.vat) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-slate-900">
                <td className="pt-2 pr-2">Total</td>
                <td className="pt-2 pr-2 text-right">{money(lc.totals.customsValue)}</td>
                <td className="pt-2 pr-2 text-right">{money(lc.totals.duty)}</td>
                <td className="pt-2 text-right">{lc.vatRate != null ? money(lc.totals.vat) : "—"}</td>
              </tr>
              <tr>
                <td colSpan={4} className="pt-1 text-right text-sm font-semibold text-slate-900">To pay at import (duty + VAT) ≈ {money(lc.totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No item has tariff data yet.</p>
      )}
      <p className="mt-2 text-sm text-slate-800">
        <b>Paid by: {lc.payer.text}</b>
        <span className="text-xs text-slate-600"> · {inc.who}{lc.payer.assumed ? " (Incoterm assumed from the site type.)" : ""}</span>
      </p>
      {lc.skipped.length > 0 && <p className="mt-1 text-xs text-slate-500">Not included: {lc.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.</p>}
      <p className="mt-2 text-[11px] text-slate-500">
        Estimate in £: customs value ≈ goods + a share of the freight (split by value); duty from the UK Trade Tariff (UK preference for UK-made goods, else the standard rate) plus anti-dumping for the origin; import VAT {lc.vatRate != null ? `at ${lc.vatRate}% in ${dest}` : "not known for this destination"} on value + duty. Customs converts to euros and may value differently. Confirm with your broker.{" "}
        <a href={SOURCES.euVat.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">VAT rates<ExternalLink className="h-3 w-3" aria-hidden /></a>
      </p>
    </section>
  );
}

export function ComplianceChecklist({ analysis, hs, onPatch }: { analysis: Analysis; hs: HsLookup | null; onPatch: (p: Patch[]) => void }) {
  const b = analysis.booking;
  const tariff = useTariffs(b, hs);
  if (!b.items.length) return null;
  const items = buildChecklist(analysis, tariff);
  const states = Object.values(tariff);
  const loading = states.filter((s) => s === "loading").length;
  const failed = states.some((s) => s === "error");
  const lc = landedCost(analysis, tariff);

  const toggle = (key: string) => () => onPatch([{ kind: "booking", field: "confirmations", value: { ...(b.confirmations ?? {}), [key]: !b.confirmations?.[key] } }]);

  return (
    <div className="text-slate-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-brand" aria-hidden />Compliance checklist</h3>
        <span className="text-xs text-slate-500">Official tariff data + general guidance · advisory, doesn&apos;t block booking</span>
      </div>

      <div aria-live="polite">
        {loading > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />Checking the UK Trade Tariff for {loading} product{loading > 1 ? "s" : ""}…
          </p>
        )}
        {failed && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
            <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />Couldn&apos;t reach the UK Trade Tariff — the 11 checks still apply.
          </p>
        )}
      </div>

      <ol className="mt-3 space-y-3">
        {STAGES.map((s) => {
          const list = items.filter((i) => i.stage === s.id).sort((x, y) => Number(x.type === "advisory") - Number(y.type === "advisory"));
          if (!list.length) return null;
          const counted = list.filter((i) => i.type !== "advisory");
          const done = counted.filter((i) => i.done).length;
          const pct = counted.length ? Math.round((done / counted.length) * 100) : 100;
          return (
            <li key={s.id} className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{s.label}</h4>
                {counted.length > 0 && (
                  <span className="flex items-center gap-2" aria-label={`${done} of ${counted.length} done`}>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"><span className={cx("block h-full rounded-full", done === counted.length ? "bg-emerald-600" : "bg-brand")} style={{ width: `${pct}%` }} /></span>
                    <span className="text-xs font-semibold tabular-nums text-slate-700">{done}/{counted.length}</span>
                  </span>
                )}
              </div>
              <ul className="divide-y divide-slate-100 px-3">
                {list.map((item) => (
                  <Row key={item.id} item={item} onToggle={item.action?.kind === "confirm" ? toggle(item.action.key) : undefined} />
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      <LandedCostBlock lc={lc} dest={b.destCountry} />

      <p className="mt-2 text-[11px] text-slate-500">
        Product rules are general guidance —{" "}
        <a href={SOURCES.access2markets.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">check Access2Markets<ExternalLink className="h-3 w-3" aria-hidden /></a>{" "}
        for your exact product. Not covered: national rules, VAT registration specifics, conformity testing, packaging EPR, sanctions screening.
      </p>
    </div>
  );
}
