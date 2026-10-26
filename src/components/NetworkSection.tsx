"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { cityCode, roadKm } from "@/lib/geo";
import type { Status } from "@/lib/types";
import type { Lane } from "./RouteMap";
import { cx } from "./ui";

const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-ink-2" /> });

export type NetworkFilter = "all" | "booked" | "pending" | "blocked";
export type NetworkState = "booked" | Status;

export interface NetworkLane {
  id: string;
  origin: string;
  dest: string;
  state: NetworkState;
  pallets: number;
  label: string;
  /** Booked and still moving: drawn with the dash flow. */
  moving?: boolean;
}

const HEIGHT = 420;
const LIST_W = 248;

const DOT: Record<NetworkState, string> = {
  booked: "bg-teal-400",
  ready: "border-2 border-teal-400 bg-transparent",
  review: "bg-amber-400",
  blocked: "bg-red-500",
};
const STATE_LABEL: Record<NetworkState, string> = { booked: "Booked", ready: "Ready", review: "Review", blocked: "Blocked" };

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function LegendLine({ color, dash, flow }: { color: string; dash?: string; flow?: boolean }) {
  return (
    <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden className="shrink-0">
      <line x1="1" y1="3" x2="21" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash} strokeLinecap="round" opacity={flow ? 0.55 : 1} />
      {flow && <line x1="1" y1="3" x2="21" y2="3" stroke="#99F6E4" strokeWidth="1.5" strokeDasharray="3 5" strokeLinecap="round" />}
    </svg>
  );
}

function LaneList({ lanes, hover, setHover, onOpen, className }: { lanes: NetworkLane[]; hover: string | null; setHover: (id: string | null) => void; onOpen: (id: string) => void; className?: string }) {
  return (
    <ul className={cx("divide-y divide-white/5 overflow-y-auto scroll-thin", className)} onMouseLeave={() => setHover(null)}>
      {lanes.map((l) => (
        <li key={l.id}>
          <button
            onClick={() => onOpen(l.id)}
            onMouseEnter={() => setHover(l.id)}
            onFocus={() => setHover(l.id)}
            onBlur={() => setHover(null)}
            className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors focus:outline-none focus-visible:bg-white/10", hover === l.id ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}
            aria-label={`${l.id}, ${l.origin} to ${l.dest}, ${STATE_LABEL[l.state]}. Open`}
          >
            <span className={cx("h-2 w-2 shrink-0 rounded-full", DOT[l.state])} title={STATE_LABEL[l.state]} />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#e2e8f0]">{l.id}</span>
            <span className="shrink-0 font-mono text-[11px] tracking-wide text-[#b4c0d0]">{cityCode(l.origin)}<span className="px-0.5 text-[#94a3b8]">→</span>{cityCode(l.dest)}</span>
          </button>
        </li>
      ))}
      {!lanes.length && <li className="px-3 py-3 text-xs text-[#b4c0d0]">No lanes match this filter.</li>}
    </ul>
  );
}

/** Dashboard "Network" section: full-width dark control-tower map with summary, filters, lane list and legend. */
export function NetworkSection({ lanes, filter, setFilter, counts, onOpen }: {
  lanes: NetworkLane[];
  filter: NetworkFilter;
  setFilter: (f: NetworkFilter) => void;
  counts: Record<NetworkFilter, number>;
  onOpen: (id: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const wide = useWide();
  const mapLanes: Lane[] = lanes.map((l) => ({ id: l.id, origin: l.origin, dest: l.dest, status: l.state === "booked" ? "ready" : l.state, booked: l.moving, label: l.label }));
  const km = lanes.reduce((s, l) => s + (roadKm(l.origin, l.dest) ?? 0), 0);
  const figures: [string, string][] = [
    ["Lanes", String(lanes.length)],
    ["Booked", String(lanes.filter((l) => l.state === "booked").length)],
    ["Pallets", String(lanes.reduce((s, l) => s + l.pallets, 0))],
    ["Road km", km.toLocaleString("en-GB")],
  ];
  const panel = "rounded-lg bg-ink/90 ring-1 ring-inset ring-white/10";
  const filters = (
    <div className={cx("flex gap-1 rounded-lg p-0.5 ring-1 ring-inset ring-white/10", wide ? "bg-ink/90" : "bg-white/5")} role="group" aria-label="Filter lanes">
          {(["all", "booked", "pending", "blocked"] as NetworkFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cx("rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors", filter === f ? "bg-white text-ink" : "text-[#cbd5e1] hover:bg-white/10 hover:text-white")}
            >
              {f} <span className={cx("font-mono tabular-nums", filter === f ? "text-slate-600" : "text-[#a3b1c4]")}>{counts[f]}</span>
            </button>
          ))}
        </div>
  );

  return (
    <section aria-labelledby="network-title" className="overflow-hidden rounded-xl bg-ink ring-1 ring-ink">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h2 id="network-title" className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white">Network</h2>
          <p className="text-xs text-[#b4c0d0]">UK → EU lanes via Dover–Calais. Select a lane to open it.</p>
        </div>
        {!wide && filters}
      </header>

      <div className="relative" style={{ height: HEIGHT }}>
        <RouteMap
          lanes={mapLanes}
          variant="dark"
          height={HEIGHT}
          fitAll
          selected={hover}
          onSelect={onOpen}
          inset={wide ? { left: LIST_W, top: 8 } : { top: 56, bottom: 64 }}
          className="relative isolate h-full overflow-hidden"
        />

        {wide && <div className="absolute right-3 top-3 z-10">{filters}</div>}

        {/* Summary figures */}
        <dl className={cx("pointer-events-none absolute left-3 top-3 z-10 grid grid-cols-4 gap-3 px-3 py-2", panel)} style={wide ? { width: LIST_W } : undefined}>
          {figures.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="truncate font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#b4c0d0]">{k}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums text-white">{v}</dd>
            </div>
          ))}
        </dl>

        {/* Lane list (overlay on wide screens) */}
        {wide && (
          <div className={cx("absolute left-3 top-[70px] z-10 flex flex-col overflow-hidden", panel)} style={{ width: LIST_W, maxHeight: HEIGHT - 70 - 92 }}>
            <p className="border-b border-white/10 px-3 py-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#b4c0d0]">Lanes · {lanes.length}</p>
            <LaneList lanes={lanes} hover={hover} setHover={setHover} onOpen={onOpen} className="min-h-0 flex-1" />
          </div>
        )}

        {/* Legend */}
        <div className={cx("pointer-events-none absolute bottom-3 left-3 z-10 grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 text-[10px] text-[#cbd5e1]", panel)}>
          <span className="flex items-center gap-1.5"><LegendLine color="#14B8A6" flow />Booked</span>
          <span className="flex items-center gap-1.5"><LegendLine color="#14B8A6" />Ready</span>
          <span className="flex items-center gap-1.5"><LegendLine color="#F59E0B" dash="4 3" />Review</span>
          <span className="flex items-center gap-1.5"><LegendLine color="#EF4444" dash="2 3" />Blocked</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-teal-500 bg-teal-500" />Origin</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-teal-500" />Destination</span>
        </div>
      </div>

      {/* Lane list below the map on small screens */}
      {!wide && (
        <div className="border-t border-white/10">
          <p className="px-3 py-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#b4c0d0]">Lanes · {lanes.length}</p>
          <LaneList lanes={lanes} hover={hover} setHover={setHover} onOpen={onOpen} className="max-h-56" />
        </div>
      )}
    </section>
  );
}
