# ShipCheck

Conversational UK → EU shipment booking with a pre-flight error checker.

- **New booking**: describe a shipment in plain words. The app asks only for what's missing, derives totals, suggests HS codes, and re-runs every check on each message.
- **Check a file**: upload the Bookings + Items workbook (ShipCheck booking template). Each booking gets its issues (rule, severity, numbers, fix with one-click apply), a carrier pick for its priority with the reason, and a confirmation with next steps.
- **How it decides**: the rulebook, rate card and assumptions.

The rules (11 pre-flight checks) and carrier choice are deterministic code in `src/lib`. Google Gemini (Flash) is used only to read chat messages into fields (`src/app/api/chat/route.ts`, client in `src/lib/gemini.ts`). It rotates through `GOOGLE_GEMINI_KEY`, `GOOGLE_GEMINI_KEY_2`, ... on rate-limit/auth/server errors, then falls back to older Flash models. Without a working key the chat falls back to the editable booking card, and all checks still run.

- **Customs by product** (advisory): for each item with a listed commodity code and country of origin, `/api/tariff` reads the official UK Trade Tariff (UK export controls; EU import duty, anti-dumping and import controls via the service's EU-rules tariff) and shows duty and required documents. Cached for a day; if the service is slow or down, the fixed checks still run and the card says to verify.
- **Database** (optional, MongoDB): each browser gets a random 24-character workspace code (no login). Booked shipments and the last checked file are saved to one document per workspace in the `workspaces` collection, with the browser copy as cache and fallback. The newest copy wins on load. Set `MONGODB_URI` (and `MONGODB_PASSWORD` if the string has `<db_password>`), `MONGODB_DB`.
- **Voice** (optional 🎙 in chat): the browser records the microphone, converts it to 16 kHz WAV, and `/api/transcribe` sends it to Gemini for speech-to-text (same key rotation as chat); the seller reviews and edits the transcript before it's sent. Audio isn't stored.
- **Maps**: Leaflet with Esri World Light Gray tiles (no key). Indicative road route via Dover–Calais.
- **Alerts**: email via Resend and Telegram via a bot; configured per viewer in the Alerts panel (stored in the browser). Sent when a booking is confirmed, when an uploaded file has blocked bookings, or on demand ("Send checks").

## Run

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```

Tests: `npx vitest run` (uses `public/sample/ShipCheck_sample_bookings.xlsx`, 9 bookings with planted mistakes; regenerate with `python scripts/make_sample.py`).

## Deploy (Vercel)

Import the repo, add the variables from `.env.example` in Project → Settings → Environment Variables, deploy.

- Resend: `RESEND_API_KEY`; `RESEND_FROM` must be on a domain you verified in Resend (the default `onboarding@resend.dev` only delivers to your own Resend account email).
- Telegram: create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN`. Users connect from the Alerts panel (Open bot → Start → Connect). No login is needed to use the app.

## Data

`public/data/hs.json` is built only from HMRC's Combined Nomenclature 2026 (Crown copyright, Open Government Licence v3.0) with `python3 scripts/build_hs.py cn2026.ods`. Codes are kept exactly as published (7 or 8 digits; the file stores them as numbers, so chapters 01–09 have no leading zero). Nothing is padded or extended.
