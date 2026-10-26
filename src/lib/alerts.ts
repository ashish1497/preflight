// Alert messages (shared by client and server) and per-viewer alert settings.
import { collectionDate, gbp } from "./carriers";
import { formatDateLong } from "./dates";
import { documentChecklist } from "./confirm";
import { ruleName } from "./reference";
import type { Analysis } from "./types";

export interface AlertSettings {
  email: string;
  telegramChatId: string;
  telegramName?: string;
  useEmail: boolean;
  useTelegram: boolean;
  onConfirmed: boolean;
  onBlocked: boolean;
}

export const DEFAULT_ALERTS: AlertSettings = {
  email: "",
  telegramChatId: "",
  useEmail: false,
  useTelegram: false,
  onConfirmed: true,
  onBlocked: true,
};

export interface AlertMessage {
  subject: string;
  /** Plain lines; the server renders them as email HTML and Telegram text. */
  lines: string[];
}

const KEY = "shipcheck.alerts";
export function loadAlerts(): AlertSettings {
  try {
    return { ...DEFAULT_ALERTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_ALERTS;
  }
}
export function saveAlerts(s: AlertSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings last for this visit only */
  }
}

export function confirmedMessage(a: Analysis, ref: string, today: string): AlertMessage {
  const b = a.booking, c = a.recommendation.chosen!;
  const pending = documentChecklist(a).neededFromYou.filter((d) => !d.done).map((d) => d.name);
  return {
    subject: `Booked ${ref}: ${b.originCity} → ${b.destCity}, ${b.pallets} pallets`,
    lines: [
      `✅ Booking confirmed: ${ref}`,
      `${b.sellerName || "Your shipment"}: ${b.pallets} pallets (${b.cartons} cartons, ${b.grossWeight} kg), ${b.originCity} → ${b.destCity}, ${b.destCountry}`,
      `Carrier: ${c.option.carrier} ${c.option.service}, ${gbp(c.freight)}`,
      `Collection: ${formatDateLong(collectionDate(b, today))}`,
      `Delivery (est.): ${formatDateLong(c.eta)}`,
      ...(a.counts.amber ? [`⚠️ Went ahead with ${a.counts.amber} warning(s): ${[...new Set(a.issues.filter((i) => i.severity === "amber").map((i) => ruleName(i.rule)))].join(", ")}`] : []),
      ...(pending.length ? [`Still needed before collection: ${pending.join("; ")}`] : []),
      `Label every carton "1 of ${b.cartons}" with the reference.`,
    ],
  };
}

export function blockedMessage(analyses: Analysis[], fileName: string): AlertMessage | null {
  const blocked = analyses.filter((a) => a.status === "blocked");
  if (!blocked.length) return null;
  return {
    subject: `${blocked.length} booking(s) blocked in ${fileName}`,
    lines: [
      `⛔ ${blocked.length} of ${analyses.length} bookings in ${fileName} must be fixed before they can ship:`,
      ...blocked.slice(0, 15).map((a) => {
        const reds = a.issues.filter((i) => i.severity === "red");
        return `• ${a.booking.id} ${a.booking.sellerName}: ${reds.map((i) => `${ruleName(i.rule)}: ${i.title}`).join("; ") || a.recommendation.reason}`;
      }),
      ...(blocked.length > 15 ? [`…and ${blocked.length - 15} more.`] : []),
    ],
  };
}

export function checksMessage(a: Analysis): AlertMessage {
  const b = a.booking;
  const c = a.recommendation.chosen;
  return {
    subject: `Pre-flight checks: ${b.id === "NEW" ? "new booking" : b.id} (${a.status})`,
    lines: [
      `${{ blocked: "⛔ Blocked", review: "⚠️ Review", ready: "✅ Ready" }[a.status]}: ${b.originCity || "?"} → ${b.destCity || "?"}, ${b.pallets ?? "?"} pallets`,
      ...a.issues.filter((i) => i.severity !== "info").map((i) => `• ${ruleName(i.rule)}: ${i.title}. Fix: ${i.fix}`),
      c ? `Carrier pick: ${c.option.carrier} ${c.option.service}, ${gbp(c.freight)}, arrives ${formatDateLong(c.eta)}` : `No carrier: ${a.recommendation.reason}`,
    ],
  };
}
