"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Fragment, useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { CITY_COORDS, cityCode, routePath, type LatLng } from "@/lib/geo";
import type { Status } from "@/lib/types";

export type MapVariant = "dark" | "light";

/** Lane colours per variant. Teal = booked or ready, amber = review, red = blocked. No glow, no blur. */
const PALETTE: Record<MapVariant, { lane: Record<Status, string>; flow: string; node: string; hollow: string; bg: string }> = {
  dark: { lane: { ready: "#14B8A6", review: "#F59E0B", blocked: "#EF4444" }, flow: "#99F6E4", node: "#14B8A6", hollow: "#0B1F3A", bg: "#0B1F3A" },
  light: { lane: { ready: "#0F766E", review: "#D97706", blocked: "#DC2626" }, flow: "#5EEAD4", node: "#0F766E", hollow: "#FFFFFF", bg: "#F1F5F9" },
};

const TILES: Record<MapVariant, string> = {
  dark: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  light: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
};

// Map-only styles: Leaflet's DOM is outside Tailwind's reach. Scoped to .pf-map.
const MAP_CSS = `
.pf-map .leaflet-container{font-family:var(--font-geist-sans),system-ui,sans-serif}
.pf-map .leaflet-tooltip.pf-code{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:1px 5px;border-radius:3px;box-shadow:none}
.pf-map .leaflet-tooltip.pf-lane{font-size:11px;padding:3px 7px;border-radius:4px;box-shadow:none}
.pf-map .leaflet-tooltip.pf-code:before,.pf-map .leaflet-tooltip.pf-lane:before{display:none}
.pf-dark .leaflet-tooltip.pf-code,.pf-dark .leaflet-tooltip.pf-lane{background:#0B1F3A;color:#E2E8F0;border:1px solid rgba(148,163,184,.35)}
.pf-light .leaflet-tooltip.pf-code,.pf-light .leaflet-tooltip.pf-lane{background:#fff;color:#0B1F3A;border:1px solid #CBD5E1}
.pf-map .leaflet-control-attribution{font-size:9px;line-height:1.5;padding:0 5px}
.pf-dark .leaflet-control-attribution{background:rgba(11,31,58,.8);color:#A3B1C4}
.pf-dark .leaflet-control-attribution a{color:#CBD5E1}
.pf-light .leaflet-control-attribution{background:rgba(255,255,255,.85);color:#4B5B72}
.pf-flow{animation:pf-dash 2.4s linear infinite}
@keyframes pf-dash{to{stroke-dashoffset:-24}}
@media (prefers-reduced-motion: reduce){.pf-flow{animation:none}}
`;

/** City node: small ring. Origin filled, destination hollow. */
const node = (color: string, fill: string, size = 10) =>
  L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:999px;background:${fill};border:2px solid ${color}"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

type Inset = { top?: number; right?: number; bottom?: number; left?: number };

function Fit({ points, inset }: { points: LatLng[]; inset?: Inset }) {
  const map = useMap();
  const key = JSON.stringify([points, inset]);
  useEffect(() => {
    map.attributionControl?.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    const pad = 28;
    const fit = () => {
      map.invalidateSize();
      if (points.length)
        map.fitBounds(L.latLngBounds(points), {
          paddingTopLeft: [pad + (inset?.left ?? 0), pad + (inset?.top ?? 0)],
          paddingBottomRight: [pad + (inset?.right ?? 0), pad + (inset?.bottom ?? 0)],
          maxZoom: 6,
        });
    };
    fit();
    // Maps drawn inside a hidden tab have no size; redraw once the container becomes visible.
    const ro = new ResizeObserver(fit);
    ro.observe(map.getContainer());
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

export interface Lane {
  id: string;
  origin: string;
  dest: string;
  status: Status;
  label?: string;
  /** Booked lanes are drawn teal with a slow dash flow (unless the user prefers reduced motion). */
  booked?: boolean;
}

/**
 * Map of one or more UK → EU lanes. Tiles: Esri Canvas (World Light Gray, or World Dark Gray tinted navy), no API key needed.
 * `fitAll` keeps the view on every lane when one is selected (for hover highlighting); `inset` leaves room for overlays.
 */
export default function RouteMap({
  lanes,
  selected,
  onSelect,
  height = 220,
  variant = "light",
  fitAll = false,
  inset,
  className,
}: {
  lanes: Lane[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
  variant?: MapVariant;
  fitAll?: boolean;
  inset?: Inset;
  className?: string;
}) {
  const P = PALETTE[variant];
  const drawn = lanes.map((l) => ({ ...l, path: routePath(l.origin, l.dest) })).filter((l) => l.path);
  const focus = fitAll ? drawn : drawn.filter((l) => !selected || l.id === selected);
  const pts = (focus.length ? focus : drawn).flatMap((l) => [CITY_COORDS[l.origin], CITY_COORDS[l.dest]]);
  const fallback: LatLng[] = [[54, -3], [45.5, 13.5]];
  const origins = new Set(drawn.map((l) => l.origin));
  const cities = [...new Set(drawn.flatMap((l) => [l.origin, l.dest]))];
  const permanent = cities.length <= 4;
  const hasSel = !!selected && drawn.some((l) => l.id === selected);
  const base = variant === "dark" ? 2 : 3;
  // Draw the selected lane last so it sits on top.
  const ordered = [...drawn].sort((a, b) => Number(a.id === selected) - Number(b.id === selected));

  return (
    <div
      style={{ height, background: P.bg }}
      className={className ?? `relative isolate overflow-hidden rounded-xl ring-1 ${variant === "dark" ? "ring-white/10" : "ring-slate-200"}`}
      data-variant={variant}
    >
      <style>{MAP_CSS}</style>
      <div className={`pf-map pf-${variant} h-full w-full`}>
        <MapContainer bounds={L.latLngBounds(pts.length ? pts : fallback)} scrollWheelZoom={false} zoomControl={false} attributionControl className="h-full w-full" style={{ background: P.bg }}>
          <TileLayer
            key={variant}
            url={TILES[variant]}
            maxZoom={16}
            opacity={variant === "dark" ? 0.7 : 1}
            attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors"
          />
          <Fit points={pts.length ? pts : fallback} inset={inset} />
          {ordered.map((l) => {
            const isSel = l.id === selected;
            const dim = hasSel && !isSel;
            const color = P.lane[l.status];
            const weight = isSel ? base + 2.5 : base;
            const dash = l.booked || l.status === "ready" ? undefined : l.status === "review" ? "6 6" : "3 6";
            return (
              <Fragment key={l.id}>
                <Polyline
                  positions={l.path!}
                  eventHandlers={onSelect ? { click: () => onSelect(l.id) } : undefined}
                  pathOptions={{ color, weight, opacity: dim ? 0.25 : l.booked ? 0.55 : 0.9, dashArray: dash, lineCap: "round" }}
                >
                  {l.label && <Tooltip sticky className="pf-lane">{l.label}</Tooltip>}
                </Polyline>
                {l.booked && (
                  <Polyline
                    positions={l.path!}
                    interactive={false}
                    pathOptions={{ color: P.flow, weight: Math.max(1.5, weight - 1), opacity: dim ? 0.2 : 0.95, dashArray: "4 8", lineCap: "round", className: "pf-flow" }}
                  />
                )}
              </Fragment>
            );
          })}
          {cities.map((c) => (
            <Marker key={c} position={CITY_COORDS[c]} icon={node(P.node, origins.has(c) ? P.node : P.hollow)} title={c}>
              <Tooltip key={String(permanent)} direction="top" offset={[0, -6]} permanent={permanent} className="pf-code">
                {permanent ? cityCode(c) : `${cityCode(c)} · ${c}`}
              </Tooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
