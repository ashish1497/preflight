"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BookOpen, Cloud, FileSpreadsheet, LayoutDashboard, MessageSquareText, Settings, ShieldCheck } from "lucide-react";
import { analyze } from "@/lib/analyze";
import { loadShipments, saveShipments, toShipment, type Shipment } from "@/lib/shipments";
import { Dashboard } from "./Dashboard";
import { CLOUD_LABEL, WorkspaceModal } from "./Workspace";
import { localSavedAt, markLocalSaved, pull, push, workspaceId, type CloudState } from "@/lib/workspace";
import { blockedMessage, checksMessage, confirmedMessage, loadAlerts, type AlertMessage, type AlertSettings } from "@/lib/alerts";
import { AlertsModal, sendAlert, type AlertStatus } from "./Alerts";
import { todayIso, formatDate } from "@/lib/dates";
import { bookingRef } from "@/lib/confirm";
import { ruleName } from "@/lib/reference";
import type { Analysis, Booking, FileSummary } from "@/lib/types";
import { parseWorkbook } from "@/lib/parse";
import { ChatView } from "./ChatView";
import { EMPTY_FILE, UploadView, type FileState } from "./UploadView";
import { ConfirmModal, DocumentModal } from "./Modals";
import { MethodPage } from "./MethodPage";
import { cx, useHs } from "./ui";

type View = "dashboard" | "chat" | "upload" | "method";

const FILE_KEY = "shipcheck.file";
function loadFile(): FileState {
  try {
    return { ...EMPTY_FILE, ...JSON.parse(localStorage.getItem(FILE_KEY) ?? "{}") };
  } catch {
    return EMPTY_FILE;
  }
}

const NAV: { id: View; label: string; icon: typeof BookOpen; sub: string }[] = [
  { id: "chat", label: "New booking", icon: MessageSquareText, sub: "Describe it in plain words" },
  { id: "dashboard", label: "Shipments", icon: LayoutDashboard, sub: "Booked, pending, actions" },
  { id: "upload", label: "Bulk check", icon: FileSpreadsheet, sub: "Check a Bookings + Items file" },
  { id: "method", label: "Method", icon: BookOpen, sub: "Rules, rates, coverage" },
];

export default function App() {
  // Rendered client-only (see ClientApp), so "today" is the viewer's date and storage is available.
  const [today] = useState(todayIso);
  const hs = useHs();
  const [shipments, setShipmentsState] = useState<Shipment[]>(loadShipments);
  const [view, setView] = useState<View>(() => (shipments.length ? "dashboard" : "chat"));
  const [file, setFileState] = useState<FileState>(loadFile);
  const [selected, setSelected] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState<Analysis | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [chatRef, setChatRef] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ a: Analysis; ref: string } | null>(null);
  const [doc, setDoc] = useState<{ a: Analysis; kind: "invoice" | "packing"; ref: string | null } | null>(null);
  const [alerts, setAlerts] = useState<AlertSettings>(loadAlerts);
  const [alertStatus, setAlertStatus] = useState<AlertStatus | null>(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const alertsOn = (alerts.useEmail && !!alerts.email) || (alerts.useTelegram && !!alerts.telegramChatId);

  const analyses = useMemo(() => file.bookings.map((b) => analyze(b, today, hs)), [file.bookings, today, hs]);
  const confirmed = useMemo(() => Object.fromEntries(shipments.filter((x) => x.source === "file").map((x) => [x.booking.id, x.ref])), [shipments]);

  const setShipments = (fn: (s: Shipment[]) => Shipment[]) =>
    setShipmentsState((prev) => {
      const next = fn(prev);
      saveShipments(next);
      markLocalSaved(new Date().toISOString());
      return next;
    });
  const saveFileLocal = (next: FileState) => {
    try {
      localStorage.setItem(FILE_KEY, JSON.stringify(next));
    } catch {
      /* storage full or blocked: keep in memory */
    }
  };
  const setFile = (f: FileState | ((f: FileState) => FileState)) =>
    setFileState((prev) => {
      const next = typeof f === "function" ? f(prev) : f;
      saveFileLocal(next);
      markLocalSaved(new Date().toISOString());
      return next;
    });

  // ---- Cloud sync (MongoDB). The browser copy is the cache and the fallback.
  const [wsId] = useState(workspaceId);
  const [cloud, setCloud] = useState<CloudState>("checking");
  const [showCloud, setShowCloud] = useState(false);
  const pulled = useRef(false);
  const skipPush = useRef(false);
  const [pushNonce, setPushNonce] = useState(0);
  useEffect(() => {
    pull(wsId).then(({ state, data }) => {
      setCloud(state);
      pulled.current = true;
      if (!data) return;
      const localAt = localSavedAt();
      const remoteHas = !!data.updatedAt && (data.shipments?.length || (data.file as FileState | null)?.bookings?.length);
      if (remoteHas && (!localAt || data.updatedAt! > localAt)) {
        // Newer copy in the database (e.g. opened on another device): use it.
        skipPush.current = true;
        const sh = (data.shipments ?? []) as Shipment[];
        const fl = { ...EMPTY_FILE, ...(data.file as FileState) };
        setShipmentsState(sh);
        saveShipments(sh);
        setFileState(fl);
        saveFileLocal(fl);
        markLocalSaved(data.updatedAt!);
      } else {
        // This browser is newer (or the database is empty): push it.
        setPushNonce((n) => n + 1);
      }
    });
  }, [wsId]);
  useEffect(() => {
    if (!pulled.current) return;
    if (skipPush.current) {
      skipPush.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setCloud((c) => (c === "off" ? c : "saving"));
      const r = await push(wsId, { shipments, file });
      setCloud(r.state);
      if (r.updatedAt) markLocalSaved(r.updatedAt);
    }, 800);
    return () => clearTimeout(t);
  }, [shipments, file, wsId, pushNonce]);

  useEffect(() => {
    fetch("/api/alerts").then((r) => r.json()).then(setAlertStatus).catch(() => setAlertStatus(null));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = async (m: AlertMessage | null) => {
    if (!m || !alertsOn) return;
    setToast(`Alert: ${await sendAlert(alerts, m)}`);
  };

  const onConfirm = (a: Analysis) => {
    const fromChat = view === "chat";
    const existing = fromChat ? chatRef : confirmed[a.booking.id];
    const ref = existing ?? bookingRef(today, `${a.booking.id}${a.booking.sellerName}${Date.now()}`);
    if (!existing) {
      const booking = fromChat ? { ...a.booking, id: ref } : a.booking;
      setShipments((s) => [toShipment({ ...a, booking }, ref, today, fromChat ? "chat" : "file", fromChat ? undefined : file.fileName ?? undefined), ...s]);
      if (fromChat) setChatRef(ref);
      if (alerts.onConfirmed) notify(confirmedMessage(a, ref, today));
    }
    setConfirming({ a, ref });
  };
  const onFileChecked = (as: Analysis[], fileName: string) => {
    if (alerts.onBlocked) notify(blockedMessage(as, fileName));
  };
  const onShare = async (a: Analysis) => {
    if (!alertsOn) return setShowAlerts(true);
    setToast(`Sent: ${await sendAlert(alerts, checksMessage(a))}`);
  };
  const onDocs = (a: Analysis, kind: "invoice" | "packing") => setDoc({ a, kind, ref: view === "chat" ? chatRef : confirmed[a.booking.id] ?? null });
  const bookAnother = () => {
    setConfirming(null);
    setChatRef(null);
    setChatDraft(null);
    setChatKey((k) => k + 1);
    setView("chat");
  };
  /** A bookings file dropped into chat: becomes the Bulk check file, returns a summary for the chat card. */
  const onChatFile = async (f: File): Promise<FileSummary | { error: string }> => {
    try {
      const r = parseWorkbook(await f.arrayBuffer());
      if (!r.bookings.length) return { error: r.warnings[0] ?? "No bookings found in this file." };
      setFile({ bookings: r.bookings, warnings: r.warnings, fileName: f.name });
      const all = r.bookings.map((b) => analyze(b, today, hs));
      onFileChecked(all, f.name);
      const top = all
        .filter((a) => a.status !== "ready")
        .sort((x, y) => y.counts.red - x.counts.red || y.counts.amber - x.counts.amber)
        .slice(0, 3)
        .map((a) => ({ id: a.booking.id, seller: a.booking.sellerName, issue: ruleName(a.issues.find((i) => i.severity !== "info")?.rule ?? "DATA") }));
      setSelected(top[0]?.id ?? r.bookings[0].id);
      return { fileName: f.name, total: all.length, ready: all.filter((a) => a.status === "ready").length, review: all.filter((a) => a.status === "review").length, blocked: all.filter((a) => a.status === "blocked").length, top };
    } catch {
      return { error: "Couldn't read this file. Is it a Preflight booking workbook (.xlsx)?" };
    }
  };
  const openBulk = (id?: string) => {
    if (id) setSelected(id);
    setView("upload");
  };
  const updateShipment = (ref: string, b: Booking) => setShipments((s) => s.map((x) => (x.ref === ref ? { ...x, booking: b } : x)));

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="no-print flex shrink-0 flex-col border-b border-slate-200 bg-sidebar text-slate-600 lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-4 py-3 lg:py-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
            <ShieldCheck className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight tracking-tight text-ink">Preflight</p>
            <p className="text-[11px] leading-tight text-slate-500">Catch it before customs does.</p>
          </div>
          {/* Settings on small screens: compact icons next to the brand. */}
          <div className="flex gap-1 lg:hidden">
            <button onClick={() => setShowAlerts(true)} className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label={`Alerts ${alertsOn ? "on" : "off"}`}>
              <Bell className="h-4 w-4" />
              {alertsOn && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />}
            </button>
            <button onClick={() => setShowCloud(true)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label={`Sync: ${CLOUD_LABEL[cloud].short}`}><Cloud className="h-4 w-4" /></button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible" aria-label="Main">
          {NAV.map((n) => {
            const on = view === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "relative flex flex-1 items-center gap-2.5 whitespace-nowrap rounded-md py-2 pl-3.5 pr-3 text-left text-sm transition-colors lg:flex-none",
                  on ? "bg-white text-ink shadow-[0_1px_2px_rgba(11,31,58,0.12)] ring-1 ring-inset ring-slate-200" : "text-slate-600 hover:bg-white/70 hover:text-ink",
                )}
              >
                <span aria-hidden className={cx("absolute inset-y-1.5 left-0 w-[3px] rounded-full", on ? "bg-brand" : "bg-transparent")} />
                <n.icon className={cx("h-4 w-4 shrink-0", on ? "text-brand" : "text-slate-400")} />
                <span>
                  <span className="block font-medium">{n.label}</span>
                  <span className="hidden text-[11px] text-slate-400 lg:block">{n.sub}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-slate-200 px-2 pb-2 pt-3 lg:block" role="group" aria-labelledby="settings-label">
          <p id="settings-label" className="flex items-center gap-1.5 px-3.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><Settings className="h-3 w-3" />Settings</p>
          <button onClick={() => setShowAlerts(true)} className="flex w-full items-center gap-2.5 rounded-md py-2 pl-3.5 pr-3 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-ink">
            <Bell className="h-4 w-4 text-slate-400" />
            <span className="flex-1 font-medium">Alerts</span>
            <span className={cx("rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold", alertsOn ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{alertsOn ? "ON" : "OFF"}</span>
          </button>
          <button onClick={() => setShowCloud(true)} className="flex w-full items-center gap-2.5 rounded-md py-2 pl-3.5 pr-3 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-ink">
            <Cloud className="h-4 w-4 text-slate-400" />
            <span className="flex-1 font-medium">Sync</span>
            <span className={cx("rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold", CLOUD_LABEL[cloud].cls)}>{CLOUD_LABEL[cloud].short}</span>
          </button>
          <p className="px-3.5 pt-3 text-[11px] leading-relaxed text-slate-500">Today: <span className="tabular-nums">{formatDate(today)}</span><br />Routes: UK → Germany, France, Netherlands. Prices in GBP.</p>
        </div>
      </aside>
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <div className={cx("h-full", view !== "dashboard" && "hidden")}>
          <Dashboard
            shipments={shipments}
            checked={analyses}
            draft={chatDraft}
            today={today}
            fileName={file.fileName}
            onOpenFile={(id) => { setSelected(id); setView("upload"); }}
            onOpenChat={() => setView("chat")}
            onUpdateShipment={updateShipment}
            onShipmentEvent={(ref, e) => setShipments((list) => list.map((x) => (x.ref === ref ? { ...x, events: [...(x.events ?? []), e] } : x)))}
            onShipmentDocs={(x, kind) => setDoc({ a: analyze(x.booking, today, hs), kind, ref: x.ref })}
            onNew={(where) => (where === "chat" ? bookAnother() : setView("upload"))}
          />
        </div>
        <div className={cx("h-full", view !== "chat" && "hidden")}><ChatView key={chatKey} hs={hs} today={today} onConfirm={onConfirm} onDocs={onDocs} onShare={onShare} onDraft={setChatDraft} onFile={onChatFile} onOpenBulk={openBulk} /></div>
        <div className={cx("h-full", view !== "upload" && "hidden")}><UploadView hs={hs} today={today} onConfirm={onConfirm} onDocs={onDocs} onShare={onShare} onFileChecked={onFileChecked} confirmed={confirmed} file={file} setFile={setFile} analyses={analyses} selected={selected} setSelected={setSelected} /></div>
        <div className={cx("h-full overflow-y-auto", view !== "method" && "hidden")}><MethodPage /></div>
      </main>
      {confirming && (
        <ConfirmModal
          a={confirming.a}
          bookingRef={confirming.ref}
          today={today}
          onClose={() => setConfirming(null)}
          onDocs={(kind) => setDoc({ a: confirming.a, kind, ref: confirming.ref })}
          onBookAnother={bookAnother}
          onGoShipments={() => { setConfirming(null); setView("dashboard"); }}
        />
      )}
      {showCloud && <WorkspaceModal id={wsId} cloud={cloud} onClose={() => setShowCloud(false)} />}
      {showAlerts && <AlertsModal settings={alerts} setSettings={setAlerts} status={alertStatus} onClose={() => setShowAlerts(false)} />}
      {toast && <div role="status" className="no-print fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-white shadow-lg ring-1 ring-white/10">{toast}</div>}
      {doc && <DocumentModal kind={doc.kind} a={doc.a} hs={hs} bookingRef={doc.ref} today={today} onClose={() => setDoc(null)} />}
    </div>
  );
}
