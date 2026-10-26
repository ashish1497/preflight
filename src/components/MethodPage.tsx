"use client";
import { ArrowRight, Bot, ExternalLink, RotateCcw, Scale, UserCheck } from "lucide-react";
import BENCH from "@/data/benchmark-results.json";
import { COVERAGE_MATRIX, type CoverageRow } from "@/lib/compliance";
import { CARRIERS, MODEL, RULES, ruleName } from "@/lib/reference";
import { Card, cx, SevChip } from "./ui";

// Verified, peer-reviewed sources behind the seeded-error test method.
const SOURCES = [
  {
    title: "Messing Up with BART: Error Generation for Evaluating Data-Cleaning Algorithms",
    cite: "Arocena, Glavic, Mecca, Miller, Papotti, Santoro. Proceedings of the VLDB Endowment 9(2), 2015",
    doi: "10.14778/2850578.2850579",
    cited: 80,
    shows: "Data-quality checkers are best evaluated by injecting controlled errors (typos, missing or bogus values, outliers, rule violations) into clean data, so the true answer is known.",
    use: "We plant each booking mistake type (wrong counts, value mismatch, short HS code, missing origin, overweight pallets, restricted goods, past dates) into correct bookings at a set rate.",
  },
  {
    title: "Detecting Data Errors: Where Are We and What Needs to Be Done?",
    cite: "Abedjan, Chu, Deng, Castro Fernandez, Ilyas, Ouzzani, Papotti, Stonebraker, Tang. Proceedings of the VLDB Endowment 9(12), 2016",
    doi: "10.14778/2994509.2994518",
    cited: 250,
    shows: "On five real datasets with known errors, general-purpose error-detection tools each covered well under 100% of errors, even combined; the authors point to domain-specific checks as the way forward.",
    use: "We report recall and precision against the planted answer key, per error type, and Preflight's checks are deliberately domain-specific (shipping rules, tariff list).",
  },
  {
    title: "Applying Code Inspection to Spreadsheet Testing",
    cite: "Panko. Journal of Management Information Systems 16(2), 1999",
    doi: "10.1080/07421222.1999.11518250",
    cited: 85,
    shows: "People checking a spreadsheet seeded with errors caught 63% of them working alone, and 83% when re-checking in groups of three.",
    use: "This is our manual-review baseline: what a careful person checking a booking sheet by hand is likely to catch.",
  },
  {
    title: "Is Mutation an Appropriate Tool for Testing Experiments?",
    cite: "Andrews, Briand, Labiche. 27th International Conference on Software Engineering (ICSE), 2005, pp. 402–411",
    doi: "10.1109/ICSE.2005.1553583",
    cited: 360,
    shows: "Systematically generated faults behave like real faults in experiments, while hand-planted faults tend to be harder to detect than real ones.",
    use: "We generate mistakes by rule (not hand-picked), so results are repeatable and closer to real-world mistakes.",
  },
];

type Role = "ai" | "rules" | "you";
const ROLE: Record<Role, { label: string; cls: string }> = {
  ai: { label: "AI", cls: "bg-ai-soft text-ai" },
  rules: { label: "Rules", cls: "bg-brand-soft text-brand" },
  you: { label: "You", cls: "bg-ink text-white" },
};

/** The pre-flight loop (docs/execution-plan.md §1). */
const LOOP: { name: string; role: Role; text: string }[] = [
  { name: "Capture", role: "you", text: "Type, speak or drop a file. Every input is a patch to one living booking." },
  { name: "Understand", role: "ai", text: "Reads plain words into booking fields and suggests what's missing. Suggested, never final." },
  { name: "Check", role: "rules", text: "11 pre-flight checks and the customs checklist re-run on every patch." },
  { name: "Recommend", role: "rules", text: "Carrier pick for your priority, with the reason and the numbers." },
  { name: "Fix", role: "you", text: "Fix in place: issues show on the field, with a one-click fix where one exists." },
  { name: "Confirm", role: "you", text: "Blockers stop confirm. Warnings need a tick. Nothing is booked before this." },
  { name: "Follow-through", role: "you", text: "Documents, tasks with an owner and a deadline, status until delivered." },
];

const ROLES: { icon: typeof Bot; title: string; role: Role; text: string }[] = [
  { icon: Bot, title: "AI understands", role: "ai", text: "Turns chat and speech into booking fields and suggests values. It never decides whether a booking passes." },
  { icon: Scale, title: "Rules check", role: "rules", text: "Plain, repeatable calculations: the same booking always gets the same verdict, with the rule and the numbers." },
  { icon: UserCheck, title: "You decide", role: "you", text: "You fix, acknowledge warnings and confirm. Preflight recommends; it never books for you." },
];

const GATES: { name: string; effect: string; covers: string; cls: string; dot: string }[] = [
  { name: "Blocker", effect: "Stops confirm", covers: "Data errors, and goods not accepted on the service.", cls: "border-red-200 bg-red-50/60", dot: "bg-red-600" },
  { name: "Warning", effect: "Needs acknowledgement", covers: "Prohibitions, licences without a waiver, anti-dumping duty.", cls: "border-amber-200 bg-amber-50/60", dot: "bg-amber-500" },
  { name: "Task", effect: "Has an owner and a deadline", covers: "Documents and controls to provide before collection.", cls: "border-sky-200 bg-sky-50/60", dot: "bg-sky-700" },
  { name: "Advisory", effect: "Never blocks", covers: "Legal and market rules, labelled as general guidance.", cls: "border-slate-200 bg-slate-50", dot: "bg-slate-400" },
];

const COVERAGE_CLS: Record<CoverageRow["status"], string> = {
  "Checked (blocks/warns)": "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Advisory: "bg-sky-50 text-sky-800 ring-sky-200",
  "Not covered": "bg-slate-100 text-slate-600 ring-slate-200",
};

const linkCls = "text-brand underline-offset-2 hover:underline";

function PreflightLoop() {
  return (
    <section aria-labelledby="loop-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(11,31,58,0.10)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="loop-title" className="text-lg font-semibold text-ink">The pre-flight loop</h2>
        <p className="text-xs text-slate-500">Mistakes are made at booking and found at the border. Preflight moves discovery to the moment of booking.</p>
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
        {LOOP.map((s, i) => (
          <li key={s.name} className="relative">
            <div className="flex items-center gap-1.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[11px] font-semibold text-white tabular-nums">{i + 1}</span>
              {i < LOOP.length - 1 && <span className="hidden h-px flex-1 bg-slate-300 lg:block" aria-hidden />}
              {i < LOOP.length - 1 && <ArrowRight className="hidden h-3 w-3 shrink-0 text-slate-400 lg:block" aria-hidden />}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-900">{s.name}</p>
            <span className={cx("mt-1 inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", ROLE[s.role].cls)}>{ROLE[s.role].label}</span>
            <p className="mt-1 text-xs leading-snug text-slate-600">{s.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
        <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
        <span>Every edit (typed, spoken, a form change or an uploaded row) is a patch. Each patch re-runs all checks and the carrier choice, so the verdict you see is always current.</span>
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.title} className="rounded-lg border border-slate-200 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className={cx("flex h-6 w-6 items-center justify-center rounded-md", ROLE[r.role].cls)}><r.icon className="h-3.5 w-3.5" /></span>
              {r.title}
            </p>
            <p className="mt-1.5 text-xs leading-snug text-slate-600">{r.text}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Severity gates</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {GATES.map((g) => (
          <div key={g.name} className={cx("rounded-lg border p-3", g.cls)}>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><span className={cx("h-2 w-2 rounded-full", g.dot)} />{g.name}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-800">{g.effect}</p>
            <p className="mt-1 text-xs leading-snug text-slate-600">{g.covers}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CoverageMatrix() {
  return (
    <Card title="Coverage matrix" right={<span className="text-xs text-slate-500">What is checked, advised, or left to you and your broker</span>}>
      {COVERAGE_MATRIX.length === 0 ? (
        <p className="rounded-lg bg-surface px-3 py-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">Coverage matrix loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="py-1.5 pr-3 font-medium">Requirement area</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">How</th><th className="font-medium">Source</th></tr>
            </thead>
            <tbody>
              {COVERAGE_MATRIX.map((r) => (
                <tr key={r.area} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium text-slate-900">{r.area}</td>
                  <td className="py-2 pr-3"><span className={cx("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", COVERAGE_CLS[r.status])}>{r.status}</span></td>
                  <td className="py-2 pr-3 text-slate-700">{r.how}</td>
                  <td className="py-2 text-xs">
                    {r.source ? (
                      <a href={r.source.url} target="_blank" rel="noreferrer" className={cx("inline-flex items-center gap-1", linkCls)}>{r.source.label}<ExternalLink className="h-3 w-3" /></a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function MethodPage() {
  const routes = ["Germany", "France", "Netherlands"];
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 lg:p-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">Method</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">How Preflight decides</h1>
        <p className="mt-1 text-slate-600">Every check and the carrier choice are plain, repeatable calculations. The AI only reads your messages into booking fields; it never decides whether a booking passes.</p>
      </div>

      <PreflightLoop />

      <Card title="Pre-flight checks">
        <ul className="divide-y divide-slate-100">
          {RULES.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-start sm:gap-3">
              <span className="font-semibold text-slate-900 sm:w-40 sm:shrink-0">{r.name}</span>
              <span className="flex-1 text-slate-700">{r.rule}</span>
              <span className="shrink-0"><SevChip s={r.severity}>{r.advisory ? "Advisory" : r.severity === "red" ? "Blocker" : "Warning"}</SevChip></span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Blocker = the shipment must not go until fixed (confirm is blocked). Warning = risky; you can go ahead after ticking that you&apos;ve checked. Customs description is advisory and never blocks.</p>
      </Card>

      <Card title="Carrier rate card (UK →)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm tabular-nums">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="py-1 font-medium">Service</th>{routes.map((r) => <th key={r} className="font-medium">£/pallet {r}</th>)}<th className="font-medium">Transit</th><th className="font-medium">On-time</th><th className="font-medium">Max kg/pallet</th></tr>
            </thead>
            <tbody>
              {["Carrier A", "Carrier B", "Carrier C"].map((c) => {
                const rows = CARRIERS.filter((x) => x.carrier === c);
                return (
                  <tr key={c} className="border-t border-slate-100">
                    <td className="py-1.5">{c} · {rows[0].service}</td>
                    {routes.map((r) => <td key={r}>£{rows.find((x) => x.destCountry === r)?.pricePerPallet}</td>)}
                    <td>{rows[0].transitDays} days</td><td>{rows[0].onTimeRate}%</td><td>{rows[0].maxWeightPerPallet}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Picking a carrier">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>Keep only services on the route whose pallet limit fits your load (pallet weight), and that arrive by your needed-by date if you gave one.</li>
          <li><b>Cheapest</b>: lowest price × pallets. <b>Fastest</b>: fewest transit days. <b>Most reliable</b>: highest on-time rate.</li>
          <li><b>Balanced</b>: lowest total cost = freight + goods value × {MODEL.holdingRatePerDay * 100}% per day in transit + (100% − on-time rate) × £{MODEL.latePenaltyWithSlot} if a warehouse slot is booked (missed slot), else £{MODEL.latePenaltyNoSlot}. So cheap goods go economy, high-value goods go faster.</li>
          <li>If your preferred service was ruled out, we say why and what it would take (e.g. re-packing onto more pallets).</li>
        </ol>
      </Card>

      <Card title="How we test the checks (research basis)">
        <p className="text-sm text-slate-700">
          There&apos;s no history of real booking mistakes to test against, so we use a <b>seeded-error benchmark</b>: start from correct bookings, plant known mistakes of each type, and measure
          how many Preflight catches (recall), how many correct bookings it wrongly flags (false alarms) and how long it takes, against a person checking the same sheet by hand.
        </p>
        <div className="mt-3 rounded-xl bg-surface p-3 ring-1 ring-inset ring-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Results · run {BENCH.runAt} · {BENCH.bookings} bookings · seed {BENCH.setup.seed}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [`${BENCH.caught}/${BENCH.plantedTotal}`, "rulebook mistakes caught"],
              [`${BENCH.falseAlarmBookings}/${BENCH.correctBookings}`, "correct bookings wrongly flagged"],
              [`${BENCH.blockedCorrectly}/${BENCH.redPlantedBookings}`, "bookings with a must-fix mistake blocked"],
              [`${BENCH.msPerBooking.toFixed(1)} ms`, "to check one booking"],
            ].map(([v, l]) => (
              <div key={l} className="rounded-lg bg-white p-2 ring-1 ring-inset ring-slate-200">
                <p className="text-lg font-semibold text-ink tabular-nums">{v}</p>
                <p className="text-[11px] leading-tight text-slate-500">{l}</p>
              </div>
            ))}
          </div>
          <table className="mt-3 w-full text-left text-xs tabular-nums">
            <thead className="text-slate-500"><tr><th className="py-1 font-medium">Planted mistake</th><th className="font-medium">Caught</th></tr></thead>
            <tbody>
              {BENCH.perType.map((t) => (
                <tr key={t.mistake} className="border-t border-slate-200"><td className="py-1">{ruleName(t.mistake)}: {t.text}</td><td>{t.caught}/{t.planted}</td></tr>
              ))}
              {BENCH.blind.map((t) => (
                <tr key={t.type} className="border-t border-slate-200 text-amber-800"><td className="py-1">Outside the rules: {t.text}</td><td>{t.caught}/{t.planted}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-600">
            <b>Comparison:</b> people checking a seeded spreadsheet by hand caught 63% of errors alone and 83% in groups of three (Panko, 1999). That&apos;s a published figure, not measured
            on these bookings; the workbook below lets anyone run the same comparison.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            <b>Limits:</b> the planted mistakes come from the same rules the checks use, so this shows the checks are complete and don&apos;t over-flag, not that every real-world
            mistake is caught. Mistakes that look valid (right format, wrong fact) aren&apos;t caught: 0/{BENCH.blind.reduce((s, b) => s + b.planted, 0)} above. Those need the seller&apos;s documents
            or a broker&apos;s review.
          </p>
          <p className="mt-2 flex gap-3 text-xs">
            <a href="/benchmark/ShipCheck_benchmark_bookings.xlsx" download className={linkCls}>Benchmark workbook (.xlsx)</a>
            <a href="/benchmark/answer_key.csv" download className={linkCls}>Answer key (.csv)</a>
          </p>
        </div>
        <ul className="mt-3 space-y-2.5 text-sm">
          {SOURCES.map((x) => (
            <li key={x.doi} className="rounded-lg border border-slate-200 p-3">
              <a href={`https://doi.org/${x.doi}`} target="_blank" rel="noreferrer" className={cx("font-medium", linkCls)}>{x.title}</a>
              <p className="text-xs text-slate-500">{x.cite} · cited {x.cited}+ times</p>
              <p className="mt-1 text-slate-700"><b>What it shows:</b> {x.shows}</p>
              <p className="text-slate-700"><b>How we use it:</b> {x.use}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-400">Each source checked against the published paper or its official abstract; citation counts from OpenAlex, Oct 2026.</p>
      </Card>

      <CoverageMatrix />

      <Card title="Assumptions">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Transit days are working days (Mon–Fri). Delivery date = ready date + transit.</li>
          <li>&quot;In the past&quot; (ship date) is judged against today&apos;s date when you open the app.</li>
          <li>HS codes are checked against HMRC&apos;s Combined Nomenclature 2026 and WCO HS 2022. Excel drops leading zeros, so a 5-digit code that becomes valid with a leading zero is flagged with that fix.</li>
          <li>&quot;Not accepted on road groupage&quot; (lithium batteries, aerosols, flammable liquids and gases) is found from the product description and from HS codes (e.g. 850760 lithium-ion batteries, 3303 perfumes). Unclear words like &quot;battery&quot; or &quot;spray&quot; are flagged to check, not blocked.</li>
          <li>Gross weight suggestions add ~{MODEL.kgPerCarton} kg per carton and ~{MODEL.kgPerPallet} kg per pallet for packaging.</li>
          <li>Incoterms 2020: Preflight books freight to the destination, so a booking is DAP (receiver pays EU duty and VAT) or DDP (you pay). If you don&apos;t choose, we assume DDP for warehouses (marketplaces usually expect the seller to be the importer) and DAP for business addresses, and say so on the invoice.</li>
          <li>Invoices include the UK–EU trade deal&apos;s statement on origin for UK-made items.</li>
        </ul>
      </Card>
    </div>
  );
}
