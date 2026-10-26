"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, TriangleAlert, CheckCircle2, CircleSlash, FileSpreadsheet, MessageSquareText, Package, X } from "lucide-react";
import { gbp } from "@/lib/carriers";
import { formatDate, formatDateLong } from "@/lib/dates";
import { neededFromYou } from "@/lib/confirm";
import { actionItems, allowedEvents, pendingDocs, stageOf, statusOf, type ActionItem, type Shipment, type ShipmentEvent, type Stage } from "@/lib/shipments";
import type { Analysis, Booking } from "@/lib/types";
import { NetworkSection, type NetworkFilter, type NetworkLane } from "./NetworkSection";
import { Button, Card, cx, StatusPill } from "./ui";


type Row =
  | { kind: "booked"; key: string; s: Shipment; stage: Stage; pending: number }
  | { kind: "checked"; key: string; a: Analysis };

type Filter = NetworkFilter;

const STAGE_CLS: Record<Stage, string> = {
  awaiting: "bg-emerald-100 text-emerald-800",
  transit: "bg-sky-100 text-sky-800",
  delivered: "bg-slate-200 text-slate-700",
  cancelled: "bg-red-50 text-red-700 line-through decoration-red-300",
};

function Progress({ row, today }: { row: Row; today: string }) {
  const steps = ["Checked", "Booked", "Docs", "Collected", "Delivered"];
  let done = 0;
  if (row.kind === "checked") done = row.a.status === "ready" ? 1 : 0;
  else {
    const st = statusOf(row.s, today);
    if (st.stage === "cancelled") done = 0;
    else {
      done = 2 + (row.pending === 0 ? 1 : 0);
      if (st.stage !== "awaiting") done = Math.max(done, 4);
      if (st.stage === "delivered") done = 5;
    }
  }
  return (
    <div className="flex items-center gap-0.5" title={steps.map((s, i) => `${i < done ? "✓" : "·"} ${s}`).join("  ")}>
      {steps.map((s, i) => (
        <span key={s} className={cx("h-1.5 w-5 rounded-full", i < done ? (row.kind === "booked" ? "bg-emerald-500" : "bg-brand/60") : "bg-slate-200")} />
      ))}
    </div>
  );
}

const EVENT_TEXT: Record<ShipmentEvent["type"], { button: string; title: string; body: string; dateLabel: string }> = {
  collected: { button: "Mark collected", title: "Mark as collected?", body: "Records that the carrier picked the goods up. Status moves to In transit. You can't move it back.", dateLabel: "Collected on" },
  delivered: { button: "Mark delivered", title: "Mark as delivered?", body: "Records that the receiver has the goods. This is final: no further changes after this.", dateLabel: "Delivered on" },
  cancelled: { button: "Cancel booking", title: "Cancel this booking?", body: "The shipment stays in your list as Cancelled, but can't be reactivated. Tell the carrier too: Preflight doesn't book with carriers directly.", dateLabel: "Cancelled on" },
};

function StatusChange({ s, type, today, onDone, onCancel }: { s: Shipment; type: ShipmentEvent["type"]; today: string; onDone: (e: ShipmentEvent) => void; onCancel: () => void }) {
  const t = EVENT_TEXT[type];
  const [at, setAt] = useState(today);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const danger = type === "cancelled";
  // Can't be before the booking or in the future.
  const dateOk = at >= s.bookedAt && at <= today;
  const ok = dateOk && (!danger || typed.trim().toUpperCase() === s.ref);
  return (
    <div className={cx("mt-3 rounded-xl border p-3", danger ? "border-red-300 bg-red-50/60" : "border-brand/30 bg-brand-soft/30")} role="dialog" aria-label={t.title}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">{danger && <TriangleAlert className="h-4 w-4 text-red-700" />}{t.title}</p>
      <p className="mt-0.5 text-xs text-slate-600">{t.body}</p>
      <label className="mt-2 block text-xs font-medium text-slate-600">
        {t.dateLabel}
        <input type="date" value={at} min={s.bookedAt} max={today} onChange={(e) => setAt(e.target.value)} className="mt-0.5 block rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>
      {!dateOk && <p className="text-xs text-red-700">Pick a date between the booking date ({formatDate(s.bookedAt)}) and today.</p>}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={danger ? "Reason (optional)" : "Note, e.g. driver name or POD number (optional)"} className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
      {danger && (
        <label className="mt-2 block text-xs text-slate-700">
          Type <b className="font-mono">{s.ref}</b> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-0.5 block w-full rounded-md border border-red-300 px-2 py-1 font-mono text-sm" autoComplete="off" />
        </label>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Keep as is</Button>
        <Button disabled={!ok} onClick={() => onDone({ type, at, recordedAt: today, note: note.trim() || undefined })} className={danger ? "bg-red-600 hover:bg-red-500" : undefined}>{t.button}</Button>
      </div>
    </div>
  );
}

function ShipmentDrawer({ s, today, onClose, onUpdate, onDocs, onEvent }: { s: Shipment; today: string; onClose: () => void; onUpdate: (b: Booking) => void; onDocs: (k: "invoice" | "packing") => void; onEvent: (e: ShipmentEvent) => void }) {
  const b = s.booking;
  const st = statusOf(s, today);
  const [changing, setChanging] = useState<ShipmentEvent["type"] | null>(null);
  const items = neededFromYou(b);
  const set = (field: keyof Booking, v: string) => onUpdate({ ...b, [field]: v.trim() ? (String(field).endsWith("Eori") ? v.replace(/\s/g, "").toUpperCase() : v.trim()) : null });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-xs text-slate-500">{s.ref}</p>
            <h2 className="text-lg font-semibold text-ink">{b.sellerName || "Shipment"}</h2>
            <p className="text-sm text-slate-600">{b.originCity} → {b.destCity}, {b.destCountry}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-surface p-3 text-sm tabular-nums ring-1 ring-inset ring-slate-200">
          <div><p className="text-xs text-slate-500">Status</p><p className="font-medium">{st.label}</p>{!st.confirmed && st.stage !== "awaiting" && <p className="text-[11px] text-slate-500">Estimated from dates</p>}</div>
          <div><p className="text-xs text-slate-500">Carrier</p><p className="font-medium">{s.carrier.carrier} · {s.carrier.service}</p></div>
          <div><p className="text-xs text-slate-500">Collection</p><p className="font-medium">{formatDateLong(s.collection)}</p></div>
          <div><p className="text-xs text-slate-500">Delivery (est.)</p><p className="font-medium">{formatDateLong(s.carrier.eta)}</p></div>
          <div><p className="text-xs text-slate-500">Load</p><p className="font-medium">{b.pallets} pallets · {b.cartons} cartons · {b.grossWeight} kg</p></div>
          <div><p className="text-xs text-slate-500">Price</p><p className="font-medium">{gbp(s.carrier.freight)}</p></div>
        </div>
        {s.acceptedWarnings.length > 0 && <p className="mt-3 text-xs text-amber-800">Booked with warnings: {s.acceptedWarnings.join(", ")}.</p>}

        <h3 className="mt-5 text-sm font-semibold">Status</h3>
        <ol className="mt-2 space-y-1 text-xs tabular-nums text-slate-600">
          <li>Booked · {formatDate(s.bookedAt)}</li>
          {(s.events ?? []).map((e, i) => (
            <li key={i}>
              <b className="font-medium text-slate-800">{e.type[0].toUpperCase() + e.type.slice(1)}</b> · {formatDate(e.at)}
              <span className="text-slate-400"> · set manually on {formatDate(e.recordedAt)}</span>
              {e.note && <span className="block pl-2 text-slate-500">“{e.note}”</span>}
            </li>
          ))}
        </ol>
        {changing ? (
          <StatusChange s={s} type={changing} today={today} onCancel={() => setChanging(null)} onDone={(e) => { onEvent(e); setChanging(null); }} />
        ) : (
          allowedEvents(s, today).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {allowedEvents(s, today).map((t) => (
                <Button key={t} variant={t === "cancelled" ? "ghost" : "secondary"} className={t === "cancelled" ? "text-red-700 hover:bg-red-50" : undefined} onClick={() => setChanging(t)}>{EVENT_TEXT[t].button}</Button>
              ))}
            </div>
          )
        )}

        <h3 className="mt-5 text-sm font-semibold">Needed before collection</h3>
        <ul className="mt-2 space-y-3">
          {items.map((d) => (
            <li key={d.key} className="text-sm">
              <p className="flex items-center gap-2">
                {d.done ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <span className={cx("h-4 w-4 rounded border", d.error ? "border-red-500" : "border-slate-400")} />}
                <b className="font-medium">{d.name}</b>
              </p>
              {d.error && <p className="ml-6 text-xs text-red-700">{d.error}</p>}
              <div className="ml-6 mt-1 grid gap-1.5">
                {d.fields.map((f) => (
                  <input
                    key={f.field + String(b[f.field] ?? "")}
                    defaultValue={(b[f.field] as string | null | undefined) ?? ""}
                    placeholder={f.placeholder}
                    aria-label={f.label}
                    onBlur={(e) => e.target.value !== ((b[f.field] as string) ?? "") && set(f.field, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                ))}
              </div>
            </li>
          ))}
          {b.destType === "Warehouse" && (
            <li className="flex items-center justify-between gap-2 text-sm">
              <p className="flex items-center gap-2">
                {b.appointment ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <span className="h-4 w-4 rounded border border-slate-400" />}
                <b className="font-medium">Warehouse delivery slot</b>
              </p>
              {!b.appointment && <Button variant="fix" onClick={() => onUpdate({ ...b, appointment: true })}>Mark as booked</Button>}
            </li>
          )}
        </ul>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" onClick={() => onDocs("invoice")}>Commercial invoice</Button>
          <Button variant="secondary" onClick={() => onDocs("packing")}>Packing list</Button>
        </div>
      </aside>
    </div>
  );
}

export function Dashboard({ shipments, checked, draft, today, fileName, onOpenFile, onOpenChat, onUpdateShipment, onShipmentEvent, onShipmentDocs, onNew }: {
  onShipmentEvent: (ref: string, e: ShipmentEvent) => void;
  shipments: Shipment[];
  checked: Analysis[];
  draft: Analysis | null;
  today: string;
  fileName: string | null;
  onOpenFile: (id: string) => void;
  onOpenChat: () => void;
  onUpdateShipment: (ref: string, b: Booking) => void;
  onShipmentDocs: (s: Shipment, k: "invoice" | "packing") => void;
  onNew: (where: "chat" | "upload") => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const bookedIds = new Set(shipments.map((s) => s.booking.id));
  // A file booking that has been booked shows once, as booked.
  const unbooked = checked.filter((a) => !bookedIds.has(a.booking.id));

  const rows: Row[] = useMemo(() => [
    ...shipments.map((s) => ({ kind: "booked" as const, key: s.ref, s, stage: stageOf(s, today), pending: pendingDocs(s).length + (s.booking.destType === "Warehouse" && !s.booking.appointment ? 1 : 0) })),
    ...unbooked.map((a) => ({ kind: "checked" as const, key: a.booking.id, a })),
  ], [shipments, unbooked, today]);
  const actions = actionItems(shipments, unbooked, draft, today);

  const k = {
    booked: shipments.filter((s) => stageOf(s, today) !== "cancelled").length,
    transit: shipments.filter((s) => stageOf(s, today) === "transit").length,
    ready: unbooked.filter((a) => a.status === "ready").length,
    review: unbooked.filter((a) => a.status === "review").length,
    blocked: unbooked.filter((a) => a.status === "blocked").length,
    actions: actions.filter((x) => x.tone !== "indigo").length,
  };

  const matches = (r: Row, f: Filter) =>
    f === "all" ? true : f === "booked" ? r.kind === "booked" : f === "blocked" ? r.kind === "checked" && r.a.status === "blocked" : r.kind === "checked" ? r.a.status !== "blocked" : r.pending > 0;
  const shown = rows.filter((r) => matches(r, filter));
  // Network map: same filter, cancelled shipments left off.
  const live = rows.filter((r) => r.kind === "checked" || r.stage !== "cancelled");
  const laneCounts = Object.fromEntries((["all", "booked", "pending", "blocked"] as Filter[]).map((f) => [f, live.filter((r) => matches(r, f)).length])) as Record<Filter, number>;
  const lanes: NetworkLane[] = live.filter((r) => matches(r, filter)).map((r) =>
    r.kind === "booked"
      ? { id: r.s.ref, origin: r.s.booking.originCity, dest: r.s.booking.destCity, state: "booked", pallets: r.s.booking.pallets ?? 0, moving: r.stage !== "delivered", label: `${r.s.ref} · ${r.s.booking.sellerName || "Shipment"} · ${statusOf(r.s, today).label}` }
      : { id: r.a.booking.id, origin: r.a.booking.originCity, dest: r.a.booking.destCity, state: r.a.status, pallets: r.a.booking.pallets ?? 0, label: `${r.a.booking.id} · ${r.a.booking.sellerName || "Booking"} · ${{ ready: "Ready to book", review: "Needs review", blocked: "Blocked" }[r.a.status]}` },
  );
  const openLane = (id: string) => (shipments.some((s) => s.ref === id) ? setOpen(id) : onOpenFile(id));
  const openShipment = shipments.find((s) => s.ref === open) ?? null;

  const act = (x: ActionItem) => (x.target.kind === "shipment" ? setOpen(x.target.ref) : x.target.kind === "file" ? onOpenFile(x.target.id) : onOpenChat());

  if (!rows.length && !draft)
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <Package className="mx-auto h-10 w-10 text-brand" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">No shipments yet</h1>
        <p className="mt-1 text-slate-600">Book one by chat, or run a bulk check on a file of bookings. Everything you check and book shows up here with what still needs doing.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Button onClick={() => onNew("chat")}><MessageSquareText className="h-4 w-4" />New booking</Button>
          <Button variant="secondary" onClick={() => onNew("upload")}><FileSpreadsheet className="h-4 w-4" />Bulk check</Button>
        </div>
      </div>
    );

  const tile = (label: string, v: number, cls: string, f?: Filter) => (
    <button onClick={() => f && setFilter(f)} className={cx("rounded-xl border border-slate-200 bg-white p-3 text-left shadow-[0_1px_3px_rgba(11,31,58,0.10)] transition", f && "hover:border-brand/40", f && filter === f && "border-brand/50 ring-2 ring-brand/15")}>
      <p className={cx("text-2xl font-semibold tabular-nums", cls)}>{v}</p>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
    </button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Shipments</h1>
            <p className="text-sm text-slate-600">Everything you&apos;ve checked and booked, and what still needs doing. Saved in this browser.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onNew("chat")}><MessageSquareText className="h-4 w-4" />New booking</Button>
            <Button variant="secondary" onClick={() => onNew("upload")}><FileSpreadsheet className="h-4 w-4" />Bulk check</Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {tile("Booked", k.booked, "text-emerald-700", "booked")}
          {tile("In transit", k.transit, "text-sky-700", "booked")}
          {tile("Ready to book", k.ready, "text-brand", "pending")}
          {tile("Needs review", k.review, "text-amber-700", "pending")}
          {tile("Blocked", k.blocked, "text-red-700", "blocked")}
          {tile("Actions for you", k.actions, "text-ink")}
        </div>

        <NetworkSection lanes={lanes} filter={filter} setFilter={setFilter} counts={laneCounts} onOpen={openLane} />

        <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Needs your action</span>} right={<span className="text-xs text-slate-500">Soonest first</span>}>
          {actions.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Nothing waiting on you.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {actions.slice(0, 8).map((x) => (
                <li key={x.key} className="flex items-start gap-3 py-2.5">
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", x.tone === "red" ? "bg-red-500" : x.tone === "amber" ? "bg-amber-500" : "bg-ai")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{x.title}</p>
                    <p className="text-xs text-slate-500">{x.detail}</p>
                  </div>
                  <Button variant="fix" onClick={() => act(x)}>{x.cta}<ArrowRight className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
              {actions.length > 8 && <li className="pt-2 text-xs text-slate-500">+{actions.length - 8} more in the table below</li>}
            </ul>
          )}
        </Card>

        <Card
          title="All shipments"
          right={
            <div className="flex gap-1 text-xs">
              {(["all", "booked", "pending", "blocked"] as Filter[]).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={cx("rounded-md px-2 py-1 capitalize", filter === f ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100")}>{f}</button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm tabular-nums [&_td]:px-2 [&_th]:px-2">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 font-medium">Reference</th>
                  <th className="font-medium">Seller</th>
                  <th className="font-medium">Route</th>
                  <th className="font-medium">Carrier</th>
                  <th className="font-medium">Cost</th>
                  <th className="font-medium">Collection</th>
                  <th className="font-medium">Delivery</th>
                  <th className="font-medium">Progress</th>
                  <th className="font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const b = r.kind === "booked" ? r.s.booking : r.a.booking;
                  const c = r.kind === "booked" ? r.s.carrier : r.a.recommendation.chosen ? { carrier: r.a.recommendation.chosen.option.carrier, freight: r.a.recommendation.chosen.freight, eta: r.a.recommendation.chosen.eta } : null;
                  return (
                    <tr key={r.key} onClick={() => (r.kind === "booked" ? setOpen(r.s.ref) : onOpenFile(r.a.booking.id))} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                      <td className="py-2 font-mono text-xs">
                        {r.kind === "booked" ? r.s.ref : b.id}
                        <span className="block font-sans text-[10px] text-slate-400">{r.kind === "booked" ? (r.s.source === "chat" ? "Booked via chat" : `Booked from ${r.s.fileName ?? "file"}`) : `Checked · ${fileName ?? "file"}`}</span>
                      </td>
                      <td className="max-w-[160px] truncate">{b.sellerName || "—"}</td>
                      <td className="whitespace-nowrap">{b.originCity} → {b.destCity}</td>
                      <td className="whitespace-nowrap">{c ? c.carrier : "—"}</td>
                      <td>{c ? gbp(c.freight) : "—"}</td>
                      <td className="whitespace-nowrap">{r.kind === "booked" ? formatDate(r.s.collection) : formatDate(b.readyDate)}</td>
                      <td className="whitespace-nowrap">{c ? formatDate(c.eta) : "—"}</td>
                      <td><Progress row={r} today={today} /></td>
                      <td className="whitespace-nowrap">
                        {r.kind === "booked" ? (
                          <span className="inline-flex flex-col">
                            <span className={cx("inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold", STAGE_CLS[r.stage])}>{statusOf(r.s, today).label}</span>
                            {r.pending > 0 && r.stage === "awaiting" && <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700"><CircleSlash className="h-3 w-3" />{r.pending} to do</span>}
                          </span>
                        ) : (
                          <StatusPill status={r.a.status} short />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={9} className="py-6 text-center text-sm text-slate-500">Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {openShipment && (
        <ShipmentDrawer s={openShipment} today={today} onClose={() => setOpen(null)} onUpdate={(b) => onUpdateShipment(openShipment.ref, b)} onDocs={(kind) => onShipmentDocs(openShipment, kind)} onEvent={(e) => onShipmentEvent(openShipment.ref, e)} />
      )}
    </div>
  );
}
