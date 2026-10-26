"use client";
import dynamic from "next/dynamic";

// Client-only: the app depends on the viewer's date and browser file APIs.
const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading Preflight…</div>,
});

export default function ClientApp() {
  return <App />;
}
