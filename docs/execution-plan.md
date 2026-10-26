# Preflight — final execution plan (submit by 23:40 IST, 26 Oct 2026)

Status: **plan only**. Nothing below is built yet. Base commit: `5e641a0`.

---

## 0. Decisions (locked unless changed before Phase 0)

| Decision | Choice |
|---|---|
| Name | **Preflight** · tagline "Catch it before customs does." |
| Input order in chat | **Type (default)** → attach/drag a file → voice (optional mic button, never auto-on) |
| Voice engine | Browser speech-to-text (`SpeechRecognition` / `webkitSpeechRecognition`, `en-GB`), live captions, **transcript review before send**; unsupported/denied → typing, with a one-line message |
| File in chat | **Paperclip button + drag-and-drop anywhere on the chat column**; `.xlsx/.xls/.ods/.csv`; result shown as a summary card in chat + "Review in Bulk check" |
| Compliance scope | **Scope 2**: owner/when/why/source on items · official controls as Tasks with exemption confirmations · curated chapter rules (advisory) · landed cost with who pays · ICS2 reason on HS/description checks · restricted check renamed + more keywords |
| Severity policy | Blocker = data errors + not accepted on service · Warning = prohibitions, licences without waiver, anti-dumping · Task = owner + deadline · Advisory = legal/market rules, never blocks |
| Accent | Teal brand, indigo = AI/suggested, red/amber/green **only** for status |

---

## 1. System theory (drives every screen)

**The pre-flight loop.** Mistakes are made at booking and found at the border; Preflight moves discovery to the moment of booking.

1. The booking is a **living document**; every input (typed, spoken, form edit, uploaded row) is a **patch**.
2. Every patch **re-runs all checks and the carrier choice**. The seller always sees the current verdict.
3. **Three roles, never mixed:** AI *understands* (text/speech → fields, suggestions) · rules *check* (deterministic) · the human *decides* (fix, acknowledge, confirm).
4. **Severity gates:** Blocker stops confirm · Warning needs acknowledgement · Task has an owner and a deadline · Advisory never blocks.

Principles (review every screen against these): ask only what's missing · derive before asking · recommend with a reason · explain every verdict (rule, numbers, fix) · fix in place · degrade gracefully · keep official vs advisory visibly separate.

---

## 2. Design system (Phase 0 delivers this; everyone uses it)

### 2.1 Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)

| Token | Value | Use |
|---|---|---|
| `--color-ink` | `#0B1F3A` | Sidebar, headings |
| `--color-brand` | `#0F766E` (teal-700, 5.5:1 on white) | Primary buttons, links, brand mark |
| `--color-brand-soft` | `#CCFBF1` | Brand tints |
| `--color-ai` | indigo-600 `#4F46E5` | AI suggestions, "Suggested", AI-filled flash |
| `--color-ok` / `--color-warn` / `--color-err` / `--color-info` | emerald-600 / amber-600 (text amber-800) / red-600 (text red-700) / sky-700 | Status only |
| Surface | `#F5F7FA` page · white cards · slate-200 borders | |
| Radius | cards `rounded-xl` · inputs `rounded-lg` · chips `rounded-full` | |
| Type | Geist Sans; Geist Mono for refs/HS codes; **`tabular-nums` on every amount, weight, count, date** | |
| Scale | 24/32 page title · 18 section · 14 body · 12 small · 11 micro labels (uppercase, tracking-wide) | |
| Motion | 150 ms ease-out; AI-fill flash = indigo ring 1.5 s; honour `prefers-reduced-motion` | |

### 2.2 Field states (`fieldStateClass(state)` in `ui.tsx`)

| State | Look | Meaning |
|---|---|---|
| `missing` | dashed amber-400 border, amber-50/40 bg | Required, empty |
| `suggested` | indigo-300 border + "Suggested" hint | AI or calculated value, not yet confirmed |
| `verified` | slate border + small emerald tick | Filled and passes its checks |
| `warning` | amber-500 border, amber-50 bg, message under field | Amber issue on this field |
| `error` | red-500 border, red-50 bg, message under field | Red issue on this field |

### 2.3 Component inventory (owner in brackets)

`Button` `Card` `Chip` `StatusPill` `SevChip` `FieldState` `Meter` `IconButton` **[P0]** ·
`VoiceInput` `TranscriptReview` `ChatDropzone` `FileSummaryCard` `Composer` **[B]** ·
`BookingSheet` `SheetSection` `InlineIssue` **[C]** ·
`ComplianceChecklist` `ChecklistItem` `LandedCost` `ChapterRules` **[D]** ·
`AppShell` `NavRail` `SettingsMenu` `MethodPage` `CoverageMatrix` **[E]**

### 2.4 Copy rules
Sentence case · check **names** not codes (HS code, Declared value…) · £ always · dates "Fri 13 Nov 2026" in prose, DD-MM-YYYY in tables · every warning = what's wrong + numbers + how to fix · "advisory" label on anything legal/regulatory · never say "booked" before confirm.

---

## 3. Information architecture

```
Nav: New booking (default first visit) · Shipments (default once something is booked) · Bulk check · Method · Settings ▾ (Alerts, Sync)

New booking
┌───────────────────────────────┬──────────────────────────────────────────┐
│ CHAT                          │ BOOKING SHEET                 Pre-flight 9/11 ███░ │
│ messages + numbered questions │ ▸ Route ............ ✓                    │
│ file summary cards            │ ▾ Goods ............ ! 1 to fix           │
│                               │    fields with inline state + message    │
│ ┌───────────────────────────┐ │ ▸ Load · ▸ Dates & priority                │
│ │ Type…            📎  🎙  ➤ │ │ ▸ Customs & documents (checklist)         │
│ └───────────────────────────┘ │ Carrier pick + reason                      │
│ (drop a file anywhere here)   │ [ Confirm booking ▸ ] sticky              │
└───────────────────────────────┴──────────────────────────────────────────┘
```

---

## 4. Functional changes (the only ones in scope)

1. **Chat file upload**: 📎 + drag-and-drop → parse with existing `parseWorkbook` → becomes the Bulk check file (same state as today) → chat shows `FileSummaryCard` (counts ready/review/blocked, top 3 issues, "Review in Bulk check", "Open BK-xxx").
2. **Voice (optional)**: 🎙 → listening (live caption) → **review** (editable, numbers/units highlighted) → send as a normal message.
3. **Booking sheet**: sections, collapsed summaries, pre-flight meter (11 checks), issues shown **on the fields**.
4. **Compliance checklist (scope 2)** in "Customs & documents": stages × owner × type × why × source; tariff controls → Tasks with exemption tick (stored on booking); prohibitions/licences/anti-dumping → Warnings; chapter rules + GPSR → Advisory; landed cost (duty + import VAT, who pays per Incoterm); ICS2 reason on HS & description checks; restricted check renamed "Not accepted on road groupage" + keywords.
5. **IA**: rename Method, Settings menu, brand Preflight.
6. **Dashboard map as a full section** (not a small card): full-width "Network" section under the KPI tiles, ~420 px tall, with lane list overlay, status filter chips, legend and summary figures (lanes, booked, pallets, km). Clicking a lane opens the shipment drawer or the booking.
7. **Map restyle — "control tower", corporate, no glow:** dark navy basemap (Esri World Dark Gray Canvas, keyless, verified 200), navy tint to match `--color-ink`; lanes as smooth arcs (teal = booked/ready, amber dashed = review, red dashed = blocked); slow dash-flow animation on booked lanes only (off with `prefers-reduced-motion`); city nodes = small teal rings, origin vs destination distinguished by fill; labels in Geist Mono uppercase city codes (MAN, FRA); hairline borders, no blur/shadow glow, no neon. Same component powers the booking-sheet route card (light variant) and Bulk check mini map.

**Out of scope tonight** (slide 8): Gemini audio fallback, spoken replies, broker-pack PDF, Access2Markets deep links, mobile bottom drawer (only "not broken" on mobile), after-delivery tasks in dashboard.

---

## 5. Execution phases

### Phase 0 — Foundation (main session, 20:30–20:50, sequential, commit before Phase 1)
Owner: main session. Gives every subagent stable contracts so parallel work doesn't collide.

- [ ] Tokens + field states in `globals.css`; primitives in `ui.tsx` (`fieldStateClass`, `Meter`, `IconButton`, `Chip`, restyled `Button/Card/StatusPill/SevChip`).
- [ ] Brand strings → Preflight (`layout.tsx` metadata, sidebar text).
- [ ] **Contracts (stubs that compile):**
  - `src/lib/types.ts`: `Booking.confirmations?: Record<string, boolean>`; `export interface FileSummary { fileName; total; ready; review; blocked; top: { id; seller; issue }[] }`.
  - `src/lib/compliance.ts`: `export type Stage = "booking"|"collection"|"border"|"after"`, `ChecklistItem` type, `export function buildChecklist(a: Analysis, tariff: TariffByItem): ChecklistItem[]` (returns `[]`), `export const COVERAGE_MATRIX: CoverageRow[] = []`.
  - `src/components/Checklist.tsx`: `export function ComplianceChecklist(props: { analysis; hs; onPatch })` rendering nothing.
  - `ChatView` props added: `onFile(file: File): Promise<FileSummary | { error: string }>`, `onOpenBulk(id?: string): void` (wired in `App.tsx`, ChatView ignores them for now).
- [ ] `npx tsc --noEmit`, tests, build green → **commit "Phase 0 foundation"**.

### Phase 1 — Parallel subagents (20:50–22:05, each in its own git worktree)
File ownership is **exclusive**. An agent may read anything but edit only its files. Each agent: keeps `npx tsc --noEmit`, `npx vitest run`, `npm run build` green; commits on its own branch; reports what changed + anything unfinished.

| Agent | Files it owns | Depends on |
|---|---|---|
| **B — Chat input** | `ChatView.tsx`, new `VoiceInput.tsx`, `ChatDropzone.tsx`, `FileSummaryCard.tsx`, `lib/speech.ts` | Phase 0 contracts |
| **C — Booking sheet** | `BookingPanel.tsx`, new `lib/fieldStatus.ts` (+ test) | Phase 0; renders `<ComplianceChecklist/>` slot |
| **D — Compliance** | `lib/compliance.ts` (+ test), `components/Checklist.tsx`, `Customs.tsx`, `lib/rules.ts`, `lib/hs.ts`, `lib/reference.ts`, `lib/tariff.ts`, `lib/confirm.ts` | Phase 0 |
| **E — Shell & pages** | `App.tsx`, `Dashboard.tsx`, `UploadView.tsx`, `Modals.tsx`, `Alerts.tsx`, `Workspace.tsx`, `Questionnaire.tsx` (styling only), **`RouteMap.tsx`, `lib/geo.ts`** | Phase 0; imports `COVERAGE_MATRIX` |
| **G — Content** (no code) | `docs/deck-content.md`, `docs/video-script.md`, `docs/diagram.md` | Conversation context (run as a **fork**) |

#### Brief — Agent B (Chat input)
Goal: typing stays default; add 📎 upload, drag-and-drop, optional voice. Read `docs/execution-plan.md` §2, §4.1–4.2.
- Composer: text input + 📎 `IconButton` + 🎙 `IconButton` (secondary/ghost) + Send.
- Drag-and-drop: `dragenter` anywhere on the chat column shows an overlay "Drop your bookings file to check it"; accept one file of `.xlsx,.xls,.ods,.csv`; reject others with a one-line message.
- On file: append a user bubble with a file chip, call `onFile(file)`, show `FileSummaryCard` (counts, top 3 issues by check name, buttons "Review in Bulk check" → `onOpenBulk()`, each issue → `onOpenBulk(id)`). Errors → assistant bubble with the message.
- Voice (`lib/speech.ts`): feature-detect; `lang="en-GB"`, `interimResults`; states idle → listening (pulsing dot, live caption, Stop) → review (editable textarea; numbers/units/£ highlighted as chips; Send / Discard) → normal `send()`. Unsupported → mic shows tooltip "Voice isn't supported in this browser — type instead"; permission denied → one-line message. `aria-live` for state changes. No audio stored or sent anywhere except the browser's own recogniser.
- Done when: typed flow unchanged; file drop shows summary and opens Bulk check; voice fills a booking in Chrome; Firefox degrades cleanly.

#### Brief — Agent C (Booking sheet)
Goal: turn the right panel into the sectioned booking sheet with inline issue states. Read §2.2, §3, §4.3.
- `lib/fieldStatus.ts`: map issues → fields: R-01→`items[i].hsCode`, R-02→`declaredValue`, R-03→`items[i].unitsPerCarton|cartons|quantity`, R-04→`cartons`, R-05→`pallets|grossWeight`, R-06→`items[i].description`, R-07→`grossWeight`, R-08→`appointment`, R-09→`items[i].countryOfOrigin`, R-10→`readyDate`, D-01→`items[i].description`, DATA→named missing fields. Export `stateFor(field, analysis, derived)` → FieldState and `meter(analysis)` → `{passed, total: 11}`. Unit tests.
- Sections: Route · Goods · Load · Dates & priority · Customs & documents (renders `<ComplianceChecklist/>` + existing customs card) — each with status badge, collapsed one-line summary when complete, expand on click or when it has an issue.
- Header: route line (MAN → FRA), status pill, **Pre-flight n/11 meter**, "Send checks" link.
- Keep all existing behaviours: quick fixes, edits re-run checks, carrier card, documents, confirm bar, blank-state hint.
- Done when: a wrong declared value shows red on the field and in its section; meter updates live; no regressions.

#### Brief — Agent D (Compliance, scope 2)
Goal: realistic, HS-driven checklist. Read §4.4 and the severity policy in §0. **Verify every source URL resolves (200/3xx) before using it.**
- `ChecklistItem { id; stage; type: "blocker"|"warning"|"task"|"advisory"; owner: "You"|"Receiver"|"Carrier"|"Broker"; title; why; consequence?; source?: {label; url}; done?; action?: {kind:"confirm"; key} | {kind:"field"; field} }`.
- Stages: **Before booking** (existing 11 checks, mapped), **Before collection** (UK EORI; receiver; EU EORI per Incoterm; tariff controls as tasks; licences), **At the border** (carrier: export declaration, GVMS, ICS2 — owner Carrier), **After delivery** (keep proof of export).
- Tariff controls: control with waiver codes → Task "Provide {doc codes} or confirm exemption ({Y-codes}: {waiver description})" with a confirm tick stored in `booking.confirmations["{itemIndex}:{type}"]`; control without waiver (licence) → Warning; measure types matching /prohibit|restriction on entry/i → Warning; anti-dumping/countervailing > 0 → Warning with who pays.
- Chapter rules (advisory, "general guidance, check Access2Markets"): 6912/3924/7323 food contact (Reg. 1935/2004) · 61–63 textile labelling (Reg. 1007/2011) · 9503 toys (Dir. 2009/48/EC) · 8506/8507 batteries (Reg. 2023/1542) · 84/85 electrical (LVD 2014/35/EU, EMC 2014/30/EU, WEEE 2012/19/EU) · 33 cosmetics (Reg. 1223/2009) · warehouse/B2C consumer goods → GPSR (Reg. 2023/988, EU responsible person). Link EUR-Lex pages; confirm each URL.
- Landed cost (estimate, labelled): per item customs value ≈ goods value (+ proportional freight); duty = origin preference if available else standard + anti-dumping; import VAT on (value + duty) at DE 19% / FR 20% / NL 21%; who pays from Incoterm (DAP receiver, DDP you).
- Rules text: R-01 and D-01 `detail` add "EU pre-arrival filing (ICS2) needs at least a 6-digit HS code and a precise description" + link to the European Commission ICS2 page (verify URL). R-06 name → "Not accepted on road groupage"; add keywords (aftershave, camping gas, gas cartridge, drone, magnet, e-liquid) and DG HS prefixes; **benchmark must stay 79/79 with 0 false alarms**.
- `COVERAGE_MATRIX`: rows = requirement area, status = "Checked (blocks/warns)" | "Advisory" | "Not covered", source. Include the known gaps (import VAT registration specifics, national rules, product conformity testing, packaging EPR registration, sanctions/denied parties, plant health outside tariff, other DG classes).
- Done when: sample BK-101 mug shows the 79% anti-dumping warning with who pays + exemption tasks; T-shirt shows textile advisory; tests for `buildChecklist` pass.

#### Brief — Agent E (Shell & pages)
Goal: apply the design system app-wide and finish IA. Read §2, §3, §4.5.
- `App.tsx`: brand Preflight; nav New booking / Shipments / Bulk check / Method / Settings ▾ (Alerts, Sync); wire `onFile` (parse with `parseWorkbook`, `setFile`, build `FileSummary`, return it; alerts on blocked as today) and `onOpenBulk(id)` (set selected, switch view).
- Method page (renamed How it decides): pre-flight loop diagram (§1), checks, rate card, carrier logic, **coverage matrix** from `COVERAGE_MATRIX`, research + benchmark (keep), assumptions.
- Restyle Dashboard, Bulk check (UploadView), Modals, Alerts, Workspace, Questionnaire with tokens; tabular numbers; no behaviour changes.
- **Map (§4.6–4.7):** `RouteMap` gets `variant: "dark" | "light"` (keep current props working for C's route card). Dark = Esri World Dark Gray Canvas + navy tint; arcs via `lib/geo.ts`; teal/amber/red per status; dash-flow on booked lanes only; mono city codes; legend; no glow. Dashboard: full-width "Network" section (~420 px) with filter chips (All/Booked/Pending/Blocked), overlay lane list, summary figures, click → drawer/booking.
- Done when: every screen uses tokens; navigation matches §3; chat file upload lands in Bulk check; dashboard map is a full section in the dark control-tower style.

#### Brief — Agent G (Content, fork)
Write `docs/deck-content.md` (exactly 8 slides per the brief: title; problem breakdown with value-chain layers; scope incl. coverage matrix + out of scope; assumptions & how to check (10x hypothesis, Incoterm default, benchmark, Panko 63%); solution diagram (pre-flight loop); adoption (users, why switch, resistance, what happens when wrong); rollout (pilot, phases, metrics: usage share, escaped errors, false alarms ≤5%, critical misses ≤1/100); open slide + one brownie point). Speaker notes per slide, ≤40 words of slide text each. `docs/video-script.md`: 60-second shot list with on-screen text and exact inputs to type/say. `docs/diagram.md`: Mermaid of the loop + layers.

### Phase 2 — Integrate & verify (main session, 22:05–22:40)
- [ ] Merge branches in order **D → C → B → E** (D first: C and E consume its exports). Resolve conflicts.
- [ ] `npx tsc --noEmit` · `npx vitest run` · `BENCH_WRITE=1 npx vitest run src/lib/benchmark.test.ts` (79/79, 0 false alarms) · `npm run build`.
- [ ] Browser regression (judges' flows):
  1. Chat: vague description → numbered questions → "add a pallet" → meter, fields, carrier update.
  2. Chat: drop sample file → summary card → Review in Bulk check → fix → carrier reason.
  3. Voice in Chrome: speak → review → send. Firefox: mic shows fallback.
  4. BK-101: anti-dumping warning + who pays; exemption tick works; textile advisory.
  5. Confirm → next steps → Shipments; Settings → Sync shows SAVED.
  6. AI/tariff/DB unavailable → still usable.
  7. Mobile width: nothing overflows.
- [ ] Commit "Preflight release". **22:40 hard freeze.**

### Phase 3 — Ship (user, 22:45–23:40)
- [ ] Deploy to Vercel; env: `GOOGLE_GEMINI_KEY`, `GOOGLE_GEMINI_KEY_3` (key 2 is invalid), `MONGODB_URI`, `MONGODB_DB`, `RESEND_API_KEY`, `RESEND_FROM`. Atlas network access: allow from anywhere. Gemini spend cap.
- [ ] Private-window smoke test of the public link.
- [ ] Record video (script from Agent G), add links to slide 1, submit by **23:40**.

---

## 6. Risk controls
- Exclusive file ownership; contracts frozen in Phase 0; agents may not edit another agent's files (report instead).
- Every agent commits only green builds; main session can drop a branch that isn't green by 22:05 and ship without it.
- Drop order if late: Agent E restyle of secondary screens (keep IA + dashboard map section) → chapter rules → voice → landed cost. Never drop: chat upload, booking sheet inline states, benchmark green.
- No new external services; voice uses the browser only.
