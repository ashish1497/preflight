"use client";
import { ExternalLink, Landmark, Loader2 } from "lucide-react";
import { describeHs, type HsLookup } from "@/lib/hs";
import type { TariffControl } from "@/lib/tariff";
import { useTariffs } from "./useTariffs";
import { INCOTERMS, effectiveIncoterm } from "@/lib/reference";
import type { Booking } from "@/lib/types";
import { Card, cx } from "./ui";

export { useTariffs } from "./useTariffs";

function Control({ c, side }: { c: TariffControl; side: string }) {
  return (
    <li className="text-xs">
      <p className="text-slate-800">
        <span className="font-medium">{side}: {c.type}</span>
        {!c.allSubcodes && <span className="text-slate-500"> (depends on the exact 10-digit code)</span>}
      </p>
      <p className="text-slate-600">Needs one of: {c.documents.map((d) => <span key={d.code} title={d.description} className="mr-1 rounded bg-slate-100 px-1 font-mono">{d.code}</span>)}<span className="text-slate-500">{c.documents[0]?.description.slice(0, 90)}{(c.documents[0]?.description.length ?? 0) > 90 ? "…" : ""}</span></p>
      {c.waivers.length > 0 && <p className="text-slate-500">Not needed if: {c.waivers[0].description.slice(0, 110)}{c.waivers[0].description.length > 110 ? "…" : ""} <span className="font-mono">({c.waivers.map((w) => w.code).join(", ")})</span></p>}
    </li>
  );
}

export function CustomsCard({ b, hs }: { b: Booking; hs: HsLookup | null }) {
  const tariff = useTariffs(b, hs);
  if (!b.items.length) return null;
  return (
    <Card
      title={<span className="flex items-center gap-2"><Landmark className="h-4 w-4 text-slate-500" />Customs by product</span>}
      right={<span className="text-xs text-slate-500">Official UK Trade Tariff · advisory</span>}
    >
      {(() => {
        const inc = effectiveIncoterm(b);
        return (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
            <b>{inc.term} ({INCOTERMS[inc.term].name}){inc.assumed ? ", assumed from site type" : ""}:</b> {INCOTERMS[inc.term].who}
            {inc.assumed && " Change it under Dates & priority."}
          </p>
        );
      })()}
      <ul className="space-y-3">
        {b.items.map((it, i) => {
          const name = it.description || it.sku;
          if (!it.hsCode || !describeHs(it.hsCode, hs).exact)
            return <li key={i} className="text-sm text-slate-500"><b className="font-medium text-slate-700">{name}</b> · add a full commodity code from the tariff list to see duty and controls.</li>;
          if (!it.countryOfOrigin)
            return <li key={i} className="text-sm text-slate-500"><b className="font-medium text-slate-700">{name}</b> · add the country of origin: EU duty depends on where it was made.</li>;
          const t = tariff[i];
          const e = t === "error" ? { state: "error" as const } : t && typeof t === "object" ? { state: "ok" as const, data: t } : { state: "loading" as const };
          return (
            <li key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm"><b className="font-medium">{name}</b> <span className="font-mono text-xs text-slate-500">{it.hsCode}</span> <span className="text-xs text-slate-500">· made in {it.countryOfOrigin} → {b.destCountry}</span></p>
                {e.state === "ok" && (
                  <span className="flex gap-2 text-xs">
                    <a href={e.data.links.eu} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-700 hover:underline">EU import<ExternalLink className="h-3 w-3" /></a>
                    <a href={e.data.links.uk} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-700 hover:underline">UK export<ExternalLink className="h-3 w-3" /></a>
                  </span>
                )}
              </div>
              {e.state === "loading" && <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Checking the official tariff…</p>}
              {e.state === "error" && <p className="mt-1 text-xs text-amber-700">Couldn&apos;t reach the UK Trade Tariff just now. The checks above still apply; verify duty and documents for {it.hsCode} on the tariff site.</p>}
              {e.state === "ok" && (
                <>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.data.euImport.duties.map((d, k) => {
                      const bad = /anti-dumping|countervailing|additional/i.test(d.label) && d.rate !== "0.00 %";
                      const good = /Preferential/.test(d.label);
                      return (
                        <span key={k} title={d.note} className={cx("rounded-full px-2 py-0.5 text-xs ring-1 ring-inset", bad ? "bg-red-50 text-red-800 ring-red-200" : good ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-50 text-slate-700 ring-slate-200")}>
                          {d.label}: <b>{d.rate}</b>{!d.allSubcodes && " · some sub-codes"}
                        </span>
                      );
                    })}
                  </div>
                  {e.data.euImport.duties.find((d) => d.note)?.note && <p className="mt-1 text-xs text-slate-500">{e.data.euImport.duties.find((d) => d.note)!.note}</p>}
                  {(() => {
                    const all = [...e.data.euImport.controls.map((c) => ({ c, side: "EU import" })), ...e.data.ukExport.controls.map((c) => ({ c, side: "UK export" }))];
                    // Controls with an exemption (e.g. "not waste", "not a cultural object") rarely apply.
                    const firm = all.filter((x) => !x.c.waivers.length);
                    const special = all.filter((x) => x.c.waivers.length);
                    return (
                      <>
                        {firm.length > 0 ? (
                          <ul className="mt-2 space-y-1.5">{firm.map((x, k) => <Control key={k} c={x.c} side={x.side} />)}</ul>
                        ) : (
                          <p className="mt-2 text-xs text-emerald-700">No extra import or export documents required for this code.</p>
                        )}
                        {special.length > 0 && (
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-xs text-slate-500">{special.length} control{special.length > 1 ? "s" : ""} that only apply in special cases ({[...new Set(special.map((x) => x.c.type.replace(/^Export control - |^Import control - /, "")))].join(", ")})</summary>
                            <ul className="mt-1.5 space-y-1.5">{special.map((x, k) => <Control key={k} c={x.c} side={x.side} />)}</ul>
                          </details>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-slate-400">Source: UK Trade Tariff (UK export rules; EU import rules as applied by the service). Advisory only. Confirm with your customs broker. Import VAT and national rules in {b.destCountry || "the destination"} aren&apos;t included.</p>
    </Card>
  );
}
