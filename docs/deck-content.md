# Preflight — deck content (exactly 8 slides)

Format per slide: **Title** · **On-slide text** (≤40 words) · **Visual** · **Speaker notes** (≤90 words).
Numbers marked *(assumption)* are not measured. Every other number comes from our build, our benchmark or a cited source.

---

## Slide 1 — Title

**Title:** Preflight — Catch it before customs does.

**On-slide text**
- Case 2 — Conversational Shipment Booking & Pre-Flight Error Checker
- [Name 1] · [Name 2]
- MVP: [URL]
- Video: [URL]

**Visual:** Navy background, teal wordmark "Preflight", a thin teal route line MAN → FRA running under the title, small checklist tick icon. No photos.

**Speaker notes:** Preflight is a booking assistant for small UK sellers shipping pallets into Germany, France and the Netherlands. You describe the shipment in plain words, or drop your booking sheet. It asks only what's missing, checks everything customs and the warehouse will check, explains every problem with a fix, picks a carrier for your priority, and tells you what happens next.

---

## Slide 2 — Problem breakdown

**Title:** Mistakes are made at booking — and found at the border

**On-slide text**
- Who: small UK sellers, no logistics team, 1–10 pallets to the EU
- Cost: stock held at customs, refused at warehouses, found days later
- Sub-problems: long confusing forms · inconsistent counts and values · customs knowledge gaps · carrier choice · unclear next steps

**Visual:** Value-chain table, two marker columns "Error made here" (layers 1–3, red dot) and "Error found here" (layers 5–6, red dot), arrow from left to right labelled "days later".

| Layer | Who | Error made | Error found |
|---|---|---|---|
| 1 Product & order data | Seller | ● | |
| 2 Booking & planning | Seller → forwarder | ● | |
| 3 Documents & compliance | Seller / broker | ● | |
| 4 Collection & UK export | Carrier, export broker | | |
| 5 Border & EU import | Broker, EU customs | | ● |
| 6 Delivery & receiving | Carrier, warehouse | | ● |
| 7 After delivery | Seller, warehouse | | |

**Speaker notes:** The case says small mistakes cause most of the pain. Our breakdown: the mistakes happen in layers one to three, when the seller types counts, values, codes and origins into long forms. They're discovered in layers five and six, at the border or the receiving dock, after the stock has left. So the problem is really one of timing: discovery happens at the most expensive point. Everything we built moves discovery to layer two, the moment of booking.

---

## Slide 3 — Scope

**Title:** What we solve, what we deliberately don't

**On-slide text**
- In: conversational booking (type, voice, drop a file) · 10 rulebook checks + description check · carrier pick with reasons · documents & next steps
- Out: moving goods, filing declarations, paying duty, live tracking
- Why: fix the cheapest point first

**Visual:** Three-column coverage strip: **Checked (blocks / warns)** · **Advisory (shown with source)** · **Not covered (stated openly)**.

| Checked — blocks or warns | Advisory — source shown, never blocks | Not covered — stated openly |
|---|---|---|
| Counts, cartons, declared value (±1%) | Per-product duty incl. anti-dumping (UK Trade Tariff) | Import VAT registration specifics |
| HS code present & in 2026 tariff list | UK export / EU import controls, licences, exemptions | National rules in DE / FR / NL |
| Gross weight, pallet weight vs carrier | EU product rules by chapter (food contact, textiles, toys, batteries, cosmetics) | Product conformity testing |
| Restricted on road groupage (Li batteries, aerosols, flammables) | EU product safety: responsible person (GPSR) | Packaging take-back registration |
| Origin present, delivery slot, ready date, vague descriptions | Landed cost + who pays (Incoterm) | Sanctions / denied-party screening; plant health; other dangerous-goods classes |

**Speaker notes:** We solve booking, checking and deciding — the layers where mistakes are made. We don't move goods, file declarations or pay duty; carriers and brokers already do that, and we hand them clean data. Legal and market rules are shown as advisory with an official source, because a confident wrong customs answer is worse than none. And we list what we don't cover, so nobody mistakes Preflight for a customs broker.

---

## Slide 4 — Assumptions & data

**Title:** What we assumed — and how we'd check it

**On-slide text**
- Benchmark: 79/79 planted mistakes caught · 0/55 correct bookings flagged · 0.3 ms each
- Manual check (Panko 1999): 63% alone
- Limit: 0/18 "valid-looking but wrong" caught
- 10x hypothesis: unproven — pilot will test

**Visual:** Left: four benchmark tiles (79/79 · 0/55 · 42/42 blocked · 0.3 ms) plus a grey "0/18 outside the rules" tile. Right: assumptions table.

| Assumption | How we'd check it in the real world |
|---|---|
| Most booking errors are data errors in counts, values, codes, origin *(case brief; not measured)* | Review 50 past problem shipments with 5 sellers; tag each by cause |
| Escaped errors could fall from ~15% to ≤1.5% of bookings *(10x hypothesis, unproven)* | 2-week pilot: count errors found at border/warehouse per 100 bookings, before vs after |
| Booking takes 45–90 min today *(assumption)* | Timed task: same shipment, sellers' usual way vs Preflight |
| No Incoterm given → DDP for warehouses, DAP for business addresses *(assumption)* | Ask pilot sellers who pays duty today; compare with marketplace rules |
| Balanced carrier choice: 0.1%/day holding cost, £150/£50 late penalty *(assumption)* | Ask sellers their stock-out cost and warehouses their rebooking fees |
| Transit in working days *(assumption)* | Check against carrier quotes |

**Speaker notes:** We had no historical data, so we built a seeded-error benchmark — the method data-quality research uses: plant known mistakes into correct bookings and score against the answer key. 145 bookings; Preflight caught all 79 rule mistakes, flagged none of the 55 correct ones, including 15 at the limits. Published spreadsheet studies show people checking alone catch 63%. Honest limit: data that looks valid but is wrong — a real HS code for the wrong product — isn't caught. The 10x claim stays a hypothesis until a pilot measures it.

Sources (for the notes / appendix):
- Arocena et al., "Messing Up with BART", PVLDB 9(2), 2015 — https://doi.org/10.14778/2850578.2850579
- Abedjan et al., "Detecting Data Errors", PVLDB 9(12), 2016 — https://doi.org/10.14778/2994509.2994518
- Panko, "Applying Code Inspection to Spreadsheet Testing", JMIS 16(2), 1999 — https://doi.org/10.1080/07421222.1999.11518250
- Andrews, Briand, Labiche, "Is Mutation an Appropriate Tool for Testing Experiments?", ICSE 2005 — https://doi.org/10.1109/ICSE.2005.1553583

---

## Slide 5 — Solution & MVP

**Title:** The pre-flight loop: every input re-runs every check

**On-slide text**
- Type, talk or drop a file → AI understands → rules check → recommend → you fix and confirm
- AI never decides pass or fail
- Blocker stops booking · Warning needs a tick · Task has an owner

**Visual (for the designer):** One loop, left to right then back. Five rounded boxes on a navy line:
1. **Capture** (icons: keyboard, mic, file) →
2. **Understand** (indigo, label "AI: text/speech → fields") →
3. **Check** (teal, label "11 rules + official tariff data") →
4. **Recommend** (teal, label "carrier + reason, fixes") →
5. **Confirm** (label "you decide") →
then a curved arrow from Check back to Capture labelled "every change re-runs everything".
Under Check: three small gates — red "Blocker", amber "Warning (tick)", grey "Advisory". After Confirm: a short tail "Documents · Alerts · Shipments dashboard".
Three role labels underneath: **AI understands · Rules check · You decide.**

**Speaker notes:** The booking is a living document. Every sentence, answer, edit or uploaded row is a change, and every change re-runs all the checks and the carrier choice, so the seller always sees the current verdict. Three roles never mix: AI turns words into fields, deterministic rules decide pass or fail, and the human fixes and confirms. If the AI, tariff service or database is down, the checks still run. Live demo: the link in slide 1; walkthrough in the video.

---

## Slide 6 — Adoption

**Title:** Who uses it daily — and why they'd switch

**On-slide text**
- User: owner or ops person at a small UK brand
- Change: one conversation replaces forms, emails and lookups
- Resistance: trust, forwarder habits, fear of wrong customs advice
- When wrong: shown, sourced, reversible — you decide

**Visual:** Two-column "Before / With Preflight" strip (form + email chain + tariff website → one chat + checklist), and a small "When Preflight is wrong" box with three ticks.

**Speaker notes:** Our user isn't a logistics expert; they're running a small brand and book a few pallets a month. They'd switch because the cost of a held shipment is visible and painful, and Preflight shows its reasoning. They'll resist if it feels like a black box, so every flag shows the rule, numbers and fix, customs data is advisory with the official link, and nothing is booked without them confirming. If a check is wrong, they override with an acknowledgement and the case is logged for review.

---

## Slide 7 — Rollout plan

**Title:** Pilot, phases, and the numbers that decide it

**On-slide text**
- Pilot: 5 sellers, 2 weeks, real bookings
- Phase 1 checker → 2 booking via Preflight → 3 carrier/broker hand-off
- Prove it: share of bookings via Preflight · escaped errors per 100 · false alarms ≤5% · critical misses ≤1/100 · repeat use

**Visual:** Horizontal three-phase timeline with a gate between phases; under it a metric table with target and "stop if" column.

| Metric | Target | Stop / rethink if |
|---|---|---|
| Share of pilot sellers' bookings made through Preflight | Rising week on week | Flat after week 1 |
| Errors found at border or warehouse per 100 bookings | Well below the pre-pilot baseline (measured in week 0) | No change vs baseline |
| False alarms (correct bookings flagged) | ≤ 5% | > 5% |
| Critical misses (serious error passed as ready) | ≤ 1 per 100 | > 1 per 100 |
| Repeat use (books next shipment unprompted) | ≥ 2 of 5 sellers | 0 of 5 |

**Speaker notes:** Week zero: collect each seller's recent problem shipments to set a baseline. Phase one: sellers keep their usual process but run every booking through Preflight as a checker — low risk, builds trust. Phase two: they book through it. Phase three: hand clean data to their forwarder or broker. The metric that proves people are actually using it is the share of their real bookings made through Preflight. The metric that proves it works is errors that still reach the border, per hundred bookings.

---

## Slide 8 — Open slide + brownie point (next features)

**Title:** What we'd build next — in order of errors prevented

**On-slide text**
- 1 Broker pack: invoice, packing list, codes, exemptions in one PDF
- 2 Carrier API booking + live tracking
- 3 EU requirements per product (Access2Markets)
- 4 WhatsApp & spoken replies
- Each gated by pilot metrics

**Visual:** Four stacked cards with a small "prevents" tag on each (e.g. "missing licence", "lost status", "unknown product rule", "booking friction").

**Speaker notes:** Brownie point: next features, ranked by errors they'd prevent rather than by novelty. The broker pack turns our checklist into the exact codes and exemptions a broker needs, removing the last manual hand-off. Carrier APIs replace date-based status with real collection and delivery events. Per-product EU requirements close the biggest advisory gap. WhatsApp and spoken replies meet sellers where they already talk. Nothing ships unless the pilot shows false alarms ≤5% and critical misses ≤1 per 100.
