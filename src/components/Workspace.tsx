"use client";
import { useState } from "react";
import { Cloud, Copy, X } from "lucide-react";
import { switchWorkspace, type CloudState } from "@/lib/workspace";
import { Button, cx } from "./ui";

export const CLOUD_LABEL: Record<CloudState, { short: string; cls: string; text: string }> = {
  checking: { short: "…", cls: "bg-slate-100 text-slate-500", text: "Connecting to the database…" },
  synced: { short: "SAVED", cls: "bg-emerald-50 text-emerald-700", text: "Saved to the database. Open this workspace on any device with the code below." },
  saving: { short: "SAVING", cls: "bg-sky-50 text-sky-700", text: "Saving changes…" },
  offline: { short: "LOCAL", cls: "bg-amber-50 text-amber-800", text: "The database can't be reached right now. Changes are kept in this browser and saved once it's back." },
  off: { short: "LOCAL", cls: "bg-slate-100 text-slate-500", text: "No database is connected on this server (MONGODB_URI), so data is kept in this browser only." },
};

/** Shows this browser's workspace code and lets the user open another one. */
export function WorkspaceModal({ id, cloud, onClose }: { id: string; cloud: CloudState; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const valid = /^[a-z0-9]{24}$/.test(code.trim().toLowerCase()) && code.trim().toLowerCase() !== id;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4" onClick={onClose}>
      <div className="relative my-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Cloud className="h-5 w-5 text-brand" />Sync</h2>
        <p className={cx("mt-2 rounded-lg px-3 py-2 text-sm", cloud === "synced" ? "bg-emerald-50 text-emerald-900" : cloud === "offline" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700")}>{CLOUD_LABEL[cloud].text}</p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Your workspace code</p>
        <div className="mt-1 flex gap-2">
          <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">{id}</code>
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(id).then(() => setCopied(true))}><Copy className="h-4 w-4" />{copied ? "Copied" : "Copy"}</Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">No login: anyone with this code can see and change these shipments. Keep it private.</p>

        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Open another workspace</p>
        <div className="mt-1 flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a 24-character code" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
          <Button disabled={!valid} onClick={() => { switchWorkspace(code.trim().toLowerCase()); location.reload(); }}>Open</Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">This browser will show that workspace instead. Keep your current code if you want to come back.</p>
      </div>
    </div>
  );
}
