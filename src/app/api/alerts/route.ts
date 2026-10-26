// Sends alert messages by email (Resend) and Telegram (Bot API).
// Env: RESEND_API_KEY, RESEND_FROM, TELEGRAM_BOT_TOKEN. Each channel is optional.
import { z } from "zod";

const Body = z.object({
  email: z.email().max(200).optional(),
  telegramChatId: z.string().regex(/^-?\d{1,20}$/).optional(),
  message: z.object({
    subject: z.string().max(200),
    lines: z.array(z.string().max(600)).max(25),
  }),
});

// Light abuse guard: this endpoint is public, so cap sends per IP.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 6;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let botName: string | null | undefined;
async function telegramBot(token: string): Promise<string | null> {
  if (botName !== undefined) return botName ?? null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) });
    botName = (await r.json())?.result?.username ?? null;
  } catch {
    botName = null;
  }
  return botName ?? null;
}

/** Status, plus Telegram chat discovery: ?code=XYZ finds the chat that sent "/start XYZ" to the bot. */
export async function GET(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const code = new URL(req.url).searchParams.get("code");
  if (code && token) {
    if (!/^[a-z0-9]{6,32}$/i.test(code)) return Response.json({ error: "bad_code" }, { status: 400 });
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]`, { signal: AbortSignal.timeout(8000) });
    const updates: { message?: { text?: string; chat: { id: number; first_name?: string; username?: string } } }[] = (await r.json())?.result ?? [];
    const hit = updates.reverse().find((u) => u.message?.text?.trim() === `/start ${code}`);
    if (!hit?.message) return Response.json({ found: false });
    const chat = hit.message.chat;
    return Response.json({ found: true, chatId: String(chat.id), name: chat.username ? `@${chat.username}` : chat.first_name ?? "" });
  }
  return Response.json({
    email: !!process.env.RESEND_API_KEY,
    telegram: !!token,
    telegramBot: token ? await telegramBot(token) : null,
  });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { email, telegramChatId, message } = parsed.data;
  const result: { email?: string; telegram?: string } = {};

  if (email) {
    const key = process.env.RESEND_API_KEY;
    if (!key) result.email = "not_configured";
    else {
      const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">${message.lines
        .map((l, i) => (i === 0 ? `<p style="font-size:16px;font-weight:600">${esc(l)}</p>` : `<p style="margin:4px 0">${esc(l)}</p>`))
        .join("")}<p style="color:#64748b;font-size:12px;margin-top:16px">Sent by Preflight. You asked for these alerts in the app.</p></div>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: process.env.RESEND_FROM || "Preflight <onboarding@resend.dev>", to: [email], subject: message.subject, html, text: message.lines.join("\n") }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      result.email = r?.ok ? "sent" : `failed${r ? `_${r.status}` : ""}`;
    }
  }

  if (telegramChatId) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) result.telegram = "not_configured";
    else {
      const text = [`<b>${esc(message.lines[0] ?? message.subject)}</b>`, ...message.lines.slice(1).map(esc)].join("\n");
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      result.telegram = r?.ok ? "sent" : `failed${r ? `_${r.status}` : ""}`;
    }
  }

  return Response.json(result);
}
