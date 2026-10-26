"use client";
import { useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { cx } from "./ui";

/** Bookings files the chat accepts (same parser as Bulk check). */
export const BOOKING_FILE_ACCEPT = ".xlsx,.xls,.ods,.csv";
const EXTENSIONS = BOOKING_FILE_ACCEPT.split(",");

/** One spreadsheet file, or a one-line reason it can't be used. */
export function pickBookingFile(files: ArrayLike<File> | null | undefined): { file: File } | { error: string } {
  const list = files ? Array.from(files) : [];
  if (list.length === 0) return { error: "That didn't include a file. Drop or attach one bookings file (.xlsx, .xls, .ods or .csv)." };
  if (list.length > 1) return { error: `That was ${list.length} files. Drop one bookings file at a time.` };
  const file = list[0];
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!EXTENSIONS.includes(ext)) return { error: `“${file.name}” isn't a spreadsheet. Use an .xlsx, .xls, .ods or .csv bookings file.` };
  return { file };
}

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** Drag-and-drop target for a bookings file covering the whole chat column. Disabled = plain wrapper. */
export function ChatDropzone({ enabled, onFile, onReject, className, children }: {
  enabled: boolean;
  onFile: (file: File) => void;
  onReject: (reason: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child element; count them so the overlay doesn't flicker.
  const depth = useRef(0);

  if (!enabled) return <div className={className}>{children}</div>;

  return (
    <div
      className={cx("relative", className)}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const r = pickBookingFile(e.dataTransfer.files);
        if ("error" in r) onReject(r.error);
        else onFile(r.file);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-brand-soft/95 text-brand">
          <FileSpreadsheet className="h-8 w-8" aria-hidden />
          <p className="text-sm font-semibold">Drop your bookings file to check it</p>
          <p className="text-xs">.xlsx, .xls, .ods or .csv · one file</p>
        </div>
      )}
    </div>
  );
}
