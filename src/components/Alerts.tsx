"use client";
import { useState } from "react";
import { Bell, Mail, Send, X } from "lucide-react";
import { saveAlerts, type AlertMessage, type AlertSettings } from "@/lib/alerts";
import { Button, cx } from "./ui";

export interface AlertStatus {
  email: boolean;
  telegram: boolean;
  telegramBot: string | null;
}

export async function sendAlert(s: AlertSettings, message: AlertMessage): Promise<string> {
  const body = {
    email: s.useEmail && s.email ? s.email : undefined,
    telegramChatId: s.useTelegram && s.telegramChatId ? s.telegramChatId : undefined,
    message,
  };
  if (!body.email && !body.telegramChatId) return "No alert channel switched on.";
  const r = await fetch("/api/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return "Couldn't reach the alert service.";
  if (r.status === 429) return "Too many alerts in a minute. Try again shortly.";
  const res: { email?: string; telegram?: string } = await r.json().catch(() => ({}));
  const say = (ch: string, v?: string) => (v === "sent" ? `${ch} sent` : v === "not_configured" ? `${ch} isn't set up on the server` : v ? `${ch} failed` : null);
  return [say("Email", res.email), say("Telegram", res.telegram)].filter(Boolean).join(" · ") || "Nothing sent.";
}

const Toggle = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => (
  <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
    <span>{label}</span>
    <button type="button" onClick={() => set(!on)} className={cx("relative h-5 w-9 rounded-full transition", on ? "bg-brand" : "bg-slate-300")} aria-pressed={on}>
      <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", on ? "left-[18px]" : "left-0.5")} />
    </button>
  </label>
);

export function AlertsModal({ settings, setSettings, status, onClose }: { settings: AlertSettings; setSettings: (s: AlertSettings) => void; status: AlertStatus | null; onClose: () => void }) {
  const [s, setS] = useState(settings);
  const [note, setNote] = useState<string | null>(null);
  const [code] = useState(() => Math.random().toString(36).slice(2, 10));
  const [finding, setFinding] = useState(false);
  const up = (p: Partial<AlertSettings>) => {
    const next = { ...s, ...p };
    setS(next);
    setSettings(next);
    saveAlerts(next);
  };

  async function findChat() {
    setFinding(true);
    setNote(null);
    const r = await fetch(`/api/alerts?code=${code}`).then((x) => x.json()).catch(() => null);
    setFinding(false);
    if (r?.found) {
      up({ telegramChatId: r.chatId, telegramName: r.name, useTelegram: true });
      setNote(`Connected to Telegram ${r.name || r.chatId}.`);
    } else setNote("Didn't find your message yet. Open the bot, press Start, then try again.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4" onClick={onClose}>
      <div className="relative my-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Bell className="h-5 w-5 text-brand" />Alerts</h2>
        <p className="mt-1 text-sm text-slate-600">Get told when a booking is confirmed or a file has shipments that can&apos;t go. Settings stay in this browser.</p>

        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4 text-slate-500" />Email</p>
            <Toggle on={s.useEmail} set={(v) => up({ useEmail: v })} label="" />
          </div>
          <input type="email" value={s.email} onChange={(e) => up({ email: e.target.value })} placeholder="you@company.com" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
          {status && !status.email && <p className="mt-1 text-xs text-amber-700">Email sending isn&apos;t set up on this server yet (RESEND_API_KEY).</p>}
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 font-medium"><Send className="h-4 w-4 text-sky-500" />Telegram</p>
            <Toggle on={s.useTelegram} set={(v) => up({ useTelegram: v })} label="" />
          </div>
          {status?.telegramBot ? (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>
                <a className="text-brand underline" href={`https://t.me/${status.telegramBot}?start=${code}`} target="_blank" rel="noreferrer">Open @{status.telegramBot}</a> and press <b>Start</b>.
              </li>
              <li>
                Come back and <Button variant="fix" className="ml-1 px-2 py-0.5" onClick={findChat} disabled={finding}>{finding ? "Looking…" : "Connect"}</Button>
              </li>
            </ol>
          ) : (
            status && <p className="mt-1 text-xs text-amber-700">Telegram isn&apos;t set up on this server yet (TELEGRAM_BOT_TOKEN).</p>
          )}
          <input value={s.telegramChatId} onChange={(e) => up({ telegramChatId: e.target.value.trim() })} placeholder="Chat ID (filled in when you connect)" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
          {s.telegramName && <p className="mt-1 text-xs text-emerald-700">Connected: {s.telegramName}</p>}
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 px-4 py-2">
          <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Send me an alert when</p>
          <Toggle on={s.onConfirmed} set={(v) => up({ onConfirmed: v })} label="A booking is confirmed (summary + what's still needed)" />
          <Toggle on={s.onBlocked} set={(v) => up({ onBlocked: v })} label="An uploaded file has blocked bookings" />
        </div>

        {note && <p className="mt-3 text-sm text-slate-700">{note}</p>}
        <div className="mt-4 flex justify-between gap-2">
          <Button
            variant="secondary"
            onClick={async () => setNote(await sendAlert(s, { subject: "Preflight test alert", lines: ["🔔 Test alert from Preflight", "Alerts are working. You'll hear from us when bookings are confirmed or blocked."] }))}
          >
            Send test
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
