"use client";

import React, { useMemo, useState } from "react";
import type { Call, Dish } from "./types";
import { LATENCY_BUDGET_MS, addDays, dateKey, dayLabel, formatTime, keyToDate, median, percentile, plural } from "./format";
import { Empty, PageHead, Section, Segmented, SkeletonRows } from "./ui";
import { LatencyStage, STAGES, formatMs, stageSplit, visualOrder, type TimedTurn, type TurnOrder } from "./latency-stage";
import { BarRows, CallsByDay, type BarRow, type DayColumn } from "./insight-charts";

// The stage targets from the latency budget (CLAUDE.md): together they make the 800 ms.
const STAGE_TARGETS = { eou: 200, stt: 150, llm: 400, tts: 100 };
// The stage shows the latest replies; the table and the figures use the same set.
const STAGE_REPLIES = 120;
const DAYS = 14;

const OUTCOME_WORD: Record<string, string> = {
  booked: "booked a table",
  changed: "changed a booking",
  cancelled: "cancelled a booking",
  answered: "answered questions",
  message_taken: "took a message",
  transferred: "transferred",
  hung_up: "caller hung up",
  failed: "call failed"
};

const OUTCOMES: { key: string; label: string; outcomes: string[]; accent?: boolean }[] = [
  { key: "booked", label: "Booked a table", outcomes: ["booked"], accent: true },
  { key: "changed", label: "Changed or cancelled a booking", outcomes: ["changed", "cancelled"] },
  { key: "answered", label: "Answered questions only", outcomes: ["answered"] },
  { key: "message", label: "Took a message", outcomes: ["message_taken"] },
  { key: "transferred", label: "Transferred to staff", outcomes: ["transferred"] },
  { key: "ended", label: "Caller hung up or call failed", outcomes: ["hung_up", "failed"] }
];

function share(n: number, of: number) {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : "—";
}

/** Every agent reply with a voice-to-voice time, oldest call first. */
function timedTurns(calls: Call[], today: string): TimedTurn[] {
  const out: TimedTurn[] = [];
  [...calls]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .forEach((c, call) => {
      const when = `${dayLabel(dateKey(c.startedAt), today)}, ${formatTime(c.startedAt)}`;
      const callLabel = `${when}, ${OUTCOME_WORD[c.outcome] ?? c.outcome}`;
      let reply = 0;
      for (const t of [...(c.turns || [])].sort((a, b) => a.index - b.index)) {
        const l = t.latency;
        if (typeof l?.total_ms !== "number") continue;
        reply += 1;
        out.push({
          key: `${c.id}:${t.index}`,
          call,
          callLabel,
          reply,
          total: l.total_ms,
          eou: l.eou_ms ?? null,
          stt: l.stt_ms ?? null,
          llm: l.llm_ttft_ms ?? null,
          tts: l.tts_ttfb_ms ?? null,
          model: l.llm_model || "Unknown model"
        });
      }
    });
  return out.slice(-STAGE_REPLIES);
}

/** A clean axis top for a set of bar values, never below the line it has to show. */
function niceMax(values: number[], floor: number) {
  const top = Math.max(floor, ...values) * 1.08;
  const step = top > 4000 ? 1000 : top > 1500 ? 500 : 250;
  return Math.ceil(top / step) * step;
}

export function Insights({ calls, menu, loading, now }: { calls: Call[]; menu: Dish[]; loading: boolean; now: Date }) {
  const [order, setOrder] = useState<TurnOrder>("calls");
  const today = dateKey(now);
  const turns = useMemo(() => timedTurns(calls, today), [calls, today]);
  const total = calls.length;

  const totals = turns.map(t => t.total);
  const p50 = median(totals);
  const p95 = percentile(totals, 95);
  const within = totals.filter(t => t <= LATENCY_BUDGET_MS).length;

  const stageRows: BarRow[] = useMemo(() => {
    const color = Object.fromEntries(STAGES.map(s => [s.key, s.color]));
    const rows: { key: keyof typeof STAGE_TARGETS; label: string; inside?: boolean; color: string }[] = [
      { key: "eou", label: "Turn detection", color: color.eou },
      { key: "stt", label: "Speech to text", inside: true, color: color.eou },
      { key: "llm", label: "Model first token", color: color.llm },
      { key: "tts", label: "Voice first audio", color: color.tts }
    ];
    return rows.map(r => {
      const values = turns.map(t => t[r.key]).filter((v): v is number => typeof v === "number");
      const m = median(values) ?? 0;
      const target = STAGE_TARGETS[r.key];
      return {
        key: r.key,
        label: r.label,
        sub: r.inside ? `Inside turn detection · target ${target} ms` : `Target ${target} ms`,
        color: r.color,
        wash: r.inside,
        value: m,
        text: values.length ? formatMs(m) : "not timed",
        target
      };
    });
  }, [turns]);
  const stageMax = niceMax([...stageRows.map(r => r.value), ...Object.values(STAGE_TARGETS)], 0);

  const modelRows: BarRow[] = useMemo(() => {
    const byModel = new Map<string, number[]>();
    for (const t of turns) byModel.set(t.model, [...(byModel.get(t.model) || []), t.total]);
    return Array.from(byModel.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([model, values]) => {
        const m = median(values) ?? 0;
        return { key: model, label: model, sub: plural(values.length, "reply", "replies"), value: m, text: formatMs(m), color: "var(--chart-rest)" };
      });
  }, [turns]);
  const modelMax = niceMax(
    modelRows.map(r => r.value),
    LATENCY_BUDGET_MS
  );

  const outcomeRows: BarRow[] = OUTCOMES.map(o => {
    const n = calls.filter(c => o.outcomes.includes(c.outcome)).length;
    return {
      key: o.key,
      label: o.label,
      sub: `${n} of ${total}`,
      value: total ? n / total : 0,
      text: share(n, total),
      color: o.accent ? "var(--chart-booked)" : "var(--chart-rest)"
    };
  });

  const days: DayColumn[] = useMemo(
    () =>
      Array.from({ length: DAYS }, (_, i) => {
        const key = addDays(today, i - (DAYS - 1));
        const onDay = calls.filter(c => dateKey(c.startedAt) === key);
        const booked = onDay.filter(c => c.outcome === "booked").length;
        const date = keyToDate(key);
        return {
          key,
          label: dayLabel(key, today),
          short: key === today ? "Today" : `${date.getUTCDate()} ${date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`,
          booked,
          other: onDay.length - booked
        };
      }),
    [calls, today]
  );

  const disclosed = calls.filter(c => {
    const first = (c.turns || []).find(t => t.speaker === "agent");
    return first ? /\bAI\b/.test(first.text) : false;
  }).length;
  const liveWithoutAllergens = menu.filter(d => d.availableToday && !d.allergensListed).length;

  return (
    <div className="page page-insights">
      <PageHead title="Insights" sub="How the receptionist is doing, worked out from every call in the log." />

      {loading ? (
        <SkeletonRows count={5} />
      ) : total === 0 ? (
        <div className="group">
          <Empty title="No calls yet" body="Try the demo call or ring the restaurant's number. Charts appear here once calls are logged." />
        </div>
      ) : (
        <>
          <Section
            title="Response time"
            action={
              turns.length > 1 ? (
                <Segmented<TurnOrder>
                  label="Order of replies"
                  value={order}
                  onChange={setOrder}
                  options={[
                    { id: "calls", label: "Call by call" },
                    { id: "fastest", label: "Fastest first" }
                  ]}
                />
              ) : undefined
            }
            foot={`From the moment the caller stops speaking to the first audio of the reply. ${
              turns.length === STAGE_REPLIES ? `The latest ${STAGE_REPLIES} timed replies.` : ""
            }`}
          >
            {turns.length === 0 ? (
              <div className="group">
                <Empty title="No timed replies yet" body="Calls log per-reply timings once the agent reports them." />
              </div>
            ) : (
              <div className="group viz-card">
                <p className="viz-lede">
                  Median <strong>{formatMs(p50 ?? 0)}</strong>, 95th percentile <strong>{formatMs(p95 ?? 0)}</strong>.{" "}
                  <strong>
                    {within} of {plural(turns.length, "reply", "replies")}
                  </strong>{" "}
                  made the {LATENCY_BUDGET_MS} ms budget.
                </p>
                <LatencyStage turns={turns} order={order} />
                <details className="viz-table">
                  <summary>Every reply as a table</summary>
                  <div className="viz-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Call</th>
                          <th scope="col">Reply</th>
                          <th scope="col">Total</th>
                          {STAGES.map(s => (
                            <th key={s.key} scope="col">
                              {s.label}
                            </th>
                          ))}
                          <th scope="col">Model</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visualOrder(turns, order).map(i => {
                          const t = turns[i];
                          const split = stageSplit(t);
                          return (
                            <tr key={t.key}>
                              <td>{t.callLabel}</td>
                              <td>{t.reply}</td>
                              <td>{formatMs(t.total)}</td>
                              {STAGES.map(s => (
                                <td key={s.key}>{s.key === "other" ? formatMs(split.other) : t[s.key] == null ? "—" : formatMs(t[s.key] as number)}</td>
                              ))}
                              <td>{t.model}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            )}
          </Section>

          {turns.length > 0 && (
            <div className="insights-pair">
              <Section
                title="Where the time goes"
                foot={`Median time per stage across ${plural(turns.length, "reply", "replies")}. The tick marks each stage's share of the ${LATENCY_BUDGET_MS} ms budget.`}
              >
                <BarRows rows={stageRows} max={stageMax} />
              </Section>
              <Section title="By model" foot={`Median response time per language model. The line marks the ${LATENCY_BUDGET_MS} ms budget.`}>
                <BarRows rows={modelRows} max={modelMax} line={LATENCY_BUDGET_MS} />
              </Section>
            </div>
          )}

          <div className="insights-pair">
            <Section title="Calls" meta={plural(total, "call")}>
              <BarRows rows={outcomeRows} max={1} />
            </Section>
            <Section title="Calls by day" meta={`Last ${DAYS} days`}>
              <CallsByDay days={days} />
            </Section>
          </div>

          <Section title="Safeguards">
            <div className="group">
              <Kv
                label="Opened by saying it's an AI"
                value={share(disclosed, total)}
                detail={`${disclosed} of ${total} calls, from the first reply`}
              />
              <Kv
                label="Dishes on today's menu without confirmed allergens"
                value={String(liveWithoutAllergens)}
                over={liveWithoutAllergens > 0}
              />
              <Kv label="Double bookings" value="Blocked" detail="A database rule rejects two bookings on one table at once" />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Kv({ label, value, detail, over }: { label: string; value: string; detail?: string; over?: boolean }) {
  return (
    <div className="kv">
      <span className="kv-label">
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <span className="kv-value" style={{ flex: "none" }}>
        <strong className={over ? "text-red" : undefined}>{value}</strong>
      </span>
    </div>
  );
}
