"use client";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import type { Question } from "@/lib/chat";
import { Button, cx } from "./ui";

export type Answer = { option?: number; text?: string };

/** Numbered questions with choices, a recommended pick, and a free-text "Other" with example answers. */
export function Questionnaire({ questions, disabled, onSubmit }: { questions: Question[]; disabled?: boolean; onSubmit: (answers: Record<string, Answer>) => void }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const answered = questions.filter((q) => answers[q.id]?.option != null || answers[q.id]?.text?.trim()).length;
  const set = (id: string, a: Answer) => setAnswers((x) => ({ ...x, [id]: a }));

  return (
    <div className="mt-2 space-y-2.5">
      {questions.map((q, n) => {
        const a = answers[q.id] ?? {};
        // Recommended choice first.
        const opts = q.options.map((o, i) => ({ o, i })).sort((x, y) => Number(!!y.o.recommended) - Number(!!x.o.recommended));
        return (
          <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(11,31,58,0.10)]">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold tabular-nums text-white">{n + 1}</span>
              <div className="min-w-0 flex-1">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{q.header}</span>
                <p className="mt-1 text-sm font-medium text-slate-900">{q.text}</p>
                {q.hint && <p className="mt-0.5 text-xs text-slate-500">{q.hint}</p>}
              </div>
            </div>
            {opts.length > 0 && (
              <div className={cx("mt-2 grid gap-1.5", opts.length > 4 ? "grid-cols-2" : "grid-cols-1")}>
                {opts.map(({ o, i }) => {
                  const on = a.option === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled}
                      onClick={() => set(q.id, on ? {} : { option: i })}
                      className={cx(
                        "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition",
                        on ? "border-brand bg-brand-soft/40 ring-1 ring-brand" : "border-slate-200 hover:border-brand/40 hover:bg-slate-50",
                      )}
                    >
                      <span className={cx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? "border-brand bg-brand text-white" : "border-slate-300")}>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-slate-900">{o.label}</span>
                        {o.recommended && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-px align-middle text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            <Sparkles className="h-2.5 w-2.5" />Recommended
                          </span>
                        )}
                        {o.description && <span className="block text-xs text-slate-500">{o.description}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {q.other && (
              <div className="mt-2">
                <input
                  disabled={disabled}
                  value={a.text ?? ""}
                  onChange={(e) => set(q.id, { text: e.target.value })}
                  placeholder={q.options.length ? `Other: ${q.other.placeholder}` : q.other.placeholder}
                  className={cx("w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15", a.text ? "border-brand/60" : "border-slate-200")}
                />
                {q.other.examples.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">e.g.</span>
                    {q.other.examples.map((ex) => (
                      <button key={ex} type="button" disabled={disabled} onClick={() => set(q.id, { text: ex })} className="rounded-full bg-slate-100 px-2 py-0.5 text-left text-xs text-slate-700 hover:bg-brand-soft/60 hover:text-brand">
                        {ex}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{answered} of {questions.length} answered{answered < questions.length ? " · you can answer the rest later" : ""}</span>
        <Button disabled={disabled || !answered} onClick={() => onSubmit(answers)}>Send answers</Button>
      </div>
    </div>
  );
}
