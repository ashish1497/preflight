"use client";
import { CheckCircle2, Printer, X } from "lucide-react";
import { collectionDate, gbp } from "@/lib/carriers";
import { formatDate, formatDateLong } from "@/lib/dates";
import { describeHs, type HsLookup } from "@/lib/hs";
import { documentChecklist, nextSteps, priceLine } from "@/lib/confirm";
import { effectiveIncoterm, ruleName } from "@/lib/reference";
import type { Analysis } from "@/lib/types";
import { Button, cx } from "./ui";

function Modal({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4" onClick={onClose}>
      <div className={cx("relative my-8 w-full rounded-2xl bg-white shadow-xl", wide ? "max-w-4xl" : "max-w-2xl")} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="no-print absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        {children}
      </div>
    </div>
  );
}

const money = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DocumentModal({ kind, a, hs, bookingRef, today, onClose }: { kind: "invoice" | "packing"; a: Analysis; hs: HsLookup | null; bookingRef: string | null; today: string; onClose: () => void }) {
  const b = a.booking;
  const draft = !bookingRef;
  const ukItems = b.items.filter((i) => i.countryOfOrigin === "United Kingdom");
  // Carton number ranges per item: 1–90, 91–150, ...
  const ranges = b.items.reduce<{ from: number; to: number }[]>((acc, it) => {
    const from = (acc.at(-1)?.to ?? 0) + 1;
    return [...acc, { from, to: from + (it.cartons ?? 0) - 1 }];
  }, []);
  return (
    <Modal onClose={onClose} wide>
      <div className="no-print flex items-center justify-between border-b border-slate-100 px-6 py-3">
        <p className="text-sm text-slate-600">{draft ? "Draft: confirm the booking to get the final reference." : "Final document."} Use Print → Save as PDF.</p>
        <Button variant="secondary" onClick={() => window.print()} className="mr-8"><Printer className="h-4 w-4" />Print / PDF</Button>
      </div>
      <div id="print-area" className="p-6 text-sm tabular-nums text-slate-900">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{kind === "invoice" ? "COMMERCIAL INVOICE" : "PACKING LIST"}</h2>
            <p className="text-slate-600">{draft && <b className="text-amber-700">DRAFT · </b>}No. {bookingRef ?? "SC-DRAFT"} · Date {formatDate(today)}</p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>Mode: Road freight</p>
            <p>Incoterms 2020: {effectiveIncoterm(b).term} {b.destCity}{effectiveIncoterm(b).assumed ? " (assumed)" : ""}</p>
            <p>Currency: GBP</p>
            <p>Reason for export: Sale</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-slate-200 p-3 text-xs">
          <div>
            <p className="font-semibold uppercase text-slate-500">Exporter</p>
            <p className="font-medium">{b.sellerName || "—"}</p>
            <p>{b.originCity}, United Kingdom</p>
            <p>EORI: {b.exporterEori ?? <span className="text-amber-700">needed</span>}</p>
          </div>
          <div>
            <p className="font-semibold uppercase text-slate-500">Consignee / delivery</p>
            <p className="font-medium">{b.consigneeName ?? <span className="text-amber-700">Receiver name needed</span>}</p>
            <p>{b.consigneeAddress ?? `${b.destType ?? ""}, ${b.destCity}`}, {b.destCountry}</p>
            <p>{effectiveIncoterm(b).term === "DDP" ? <>Importer: exporter (DDP){b.sellerEuEori ? `, EU EORI ${b.sellerEuEori}` : ""}</> : <>EORI / VAT: {b.consigneeEori ?? <span className="text-amber-700">needed</span>}</>}</p>
          </div>
        </div>

        {kind === "invoice" ? (
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left">
                <th className="py-1">Description</th><th>HS code</th><th>Origin</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Net kg</th><th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {b.items.map((it, i) => (
                <tr key={i} className="border-b border-slate-200 align-top">
                  <td className="py-1 pr-2">{it.description}<br /><span className="text-slate-500">{it.sku} · {describeHs(it.hsCode, hs).description?.slice(0, 50)}</span></td>
                  <td className="font-mono">{it.hsCode ?? <span className="text-red-700">missing</span>}</td>
                  <td>{it.countryOfOrigin ?? <span className="text-red-700">missing</span>}</td>
                  <td className="text-right">{it.quantity}</td>
                  <td className="text-right">{it.unitPrice != null ? money(it.unitPrice) : ""}</td>
                  <td className="text-right">{((it.unitWeight ?? 0) * (it.quantity ?? 0)).toFixed(1)}</td>
                  <td className="text-right">{money((it.quantity ?? 0) * (it.unitPrice ?? 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td colSpan={5} className="py-1 text-right">Total invoice value</td><td className="text-right">{a.computed.netWeight.toFixed(1)}</td><td className="text-right">{money(a.computed.itemsValue)}</td></tr>
            </tfoot>
          </table>
        ) : (
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left">
                <th className="py-1">Carton nos.</th><th>SKU</th><th>Description</th><th className="text-right">Cartons</th><th className="text-right">Units/carton</th><th className="text-right">Units</th><th className="text-right">Net kg</th>
              </tr>
            </thead>
            <tbody>
              {b.items.map((it, i) => {
                return (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-1 font-mono">{it.cartons ? `${ranges[i].from}–${ranges[i].to}` : "—"}</td>
                    <td className="font-mono">{it.sku}</td><td>{it.description}</td>
                    <td className="text-right">{it.cartons}</td><td className="text-right">{it.unitsPerCarton}</td><td className="text-right">{it.quantity}</td>
                    <td className="text-right">{((it.unitWeight ?? 0) * (it.quantity ?? 0)).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td colSpan={3} className="py-1 text-right">Totals</td><td className="text-right">{a.computed.itemsCartons}</td><td /><td className="text-right">{b.items.reduce((s, i) => s + (i.quantity ?? 0), 0)}</td><td className="text-right">{a.computed.netWeight.toFixed(1)}</td></tr>
            </tfoot>
          </table>
        )}
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <p>Pallets: <b>{b.pallets}</b></p>
          <p>Cartons: <b>{b.cartons}</b></p>
          <p>Gross weight: <b>{b.grossWeight} kg</b></p>
        </div>
        {kind === "invoice" && ukItems.length > 0 && (
          <p className="mt-4 rounded border border-slate-200 p-2 text-xs italic">
            Statement on origin: The exporter of the products covered by this document (Exporter Reference No {b.exporterEori ?? "GB…"}) declares that, except where otherwise clearly indicated, these products are of United Kingdom preferential origin.
            {ukItems.length < b.items.length && ` Applies only to: ${ukItems.map((i) => i.sku).join(", ")}.`}
          </p>
        )}
        <p className="mt-6 text-xs text-slate-600">I declare that the information on this {kind === "invoice" ? "invoice" : "packing list"} is true and correct.</p>
        <p className="mt-6 w-64 border-t border-slate-400 pt-1 text-xs text-slate-500">Signature, name, date</p>
      </div>
    </Modal>
  );
}

export function ConfirmModal({ a, bookingRef, today, onClose, onDocs, onBookAnother, onGoShipments }: { a: Analysis; bookingRef: string; today: string; onClose: () => void; onDocs: (k: "invoice" | "packing") => void; onBookAnother: () => void; onGoShipments: () => void }) {
  const c = a.recommendation.chosen!;
  const b = a.booking;
  const docs = documentChecklist(a);
  const pending = docs.neededFromYou.filter((d) => !d.done);
  return (
    <Modal onClose={onClose}>
      <div className="p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-9 w-9 text-emerald-700" />
          <div>
            <h2 className="text-xl font-semibold text-ink">Booking confirmed</h2>
            <p className="text-sm text-slate-600">Reference <b className="font-mono text-slate-900">{bookingRef}</b>. The last digit is a check digit, so a mistyped reference is caught.</p>
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-surface p-4 text-sm tabular-nums ring-1 ring-inset ring-slate-200">
          <p className="text-base">
            <b>{b.pallets} pallet{b.pallets === 1 ? "" : "s"}</b> ({b.cartons} cartons, {b.grossWeight} kg) of {b.items.map((i) => i.description).slice(0, 2).join(" and ")}{b.items.length > 2 ? ` +${b.items.length - 2} more` : ""}
            {" "}from <b>{b.originCity}</b> to <b>{b.destCity}, {b.destCountry}</b>.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-xs text-slate-500">Carrier</p><p className="font-medium">{c.option.carrier}<br /><span className="text-slate-600">{c.option.service}</span></p></div>
            <div><p className="text-xs text-slate-500">Price</p><p className="font-medium">{gbp(c.freight)}</p><p className="text-xs text-slate-500">{priceLine(a)}</p></div>
            <div><p className="text-xs text-slate-500">Collection</p><p className="font-medium">{formatDateLong(collectionDate(b, today))}</p></div>
            <div><p className="text-xs text-slate-500">Delivery (est.)</p><p className="font-medium">{formatDateLong(c.eta)}</p><p className="text-xs text-slate-500">{c.option.onTimeRate}% on time</p></div>
          </div>
          <p className="mt-3 text-xs text-slate-600">Why this carrier: {a.recommendation.reason}</p>
          {a.counts.amber > 0 && <p className="mt-2 text-xs text-amber-800">You went ahead with {a.counts.amber} warning{a.counts.amber > 1 ? "s" : ""}: {[...new Set(a.issues.filter((i) => i.severity === "amber").map((i) => ruleName(i.rule)))].join(", ")}.</p>}
        </div>

        <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">What happens next</h3>
        <ol className="mt-2 space-y-0">
          {nextSteps(a, today).map((s, i, arr) => (
            <li key={i} className="relative flex gap-3 pb-3">
              {i < arr.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />}
              <span className="relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand bg-white" />
              <div className="text-sm">
                <p className="text-xs font-medium text-slate-500">{s.when} · {s.who}</p>
                <p className="text-slate-800">{s.what}</p>
              </div>
            </li>
          ))}
        </ol>

        {pending.length > 0 && (
          <p className="mt-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            Still needed from you before collection: {pending.map((p) => p.name).join("; ")}.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onDocs("invoice")}>Commercial invoice</Button>
          <Button variant="secondary" onClick={() => onDocs("packing")}>Packing list</Button>
          <Button variant="ghost" className="ml-auto" onClick={onBookAnother}>Book another</Button>
          <Button onClick={onGoShipments}>Go to Shipments</Button>
        </div>
      </div>
    </Modal>
  );
}
