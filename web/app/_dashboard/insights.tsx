"use client";

import React from "react";
import type { Call, Dish } from "./types";
import { LATENCY_BUDGET_MS, median, percentile, plural } from "./format";
import { Empty, PageHead, Section, SkeletonRows } from "./ui";
import { turnTotals } from "./calls";

function share(n: number, of: number) {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : "—";
}

export function Insights({ calls, menu, loading }: { calls: Call[]; menu: Dish[]; loading: boolean }) {
  const total = calls.length;
  const count = (...outcomes: string[]) => calls.filter(c => outcomes.includes(c.outcome)).length;
  const booked = count("booked", "changed");
  const transferred = count("transferred");
  const messages = count("message_taken");
  const endedEarly = count("hung_up", "failed");

  const totals = calls.flatMap(c => turnTotals(c.turns));
  const p50 = median(totals);
  const p95 = percentile(totals, 95);
  const within = totals.filter(t => t <= LATENCY_BUDGET_MS).length;

  const byModel = new Map<string, number[]>();
  for (const c of calls) {
    for (const t of c.turns || []) {
      const ms = t.latency?.total_ms;
      if (typeof ms !== "number") continue;
      const model = t.latency?.llm_model || "Unknown model";
      byModel.set(model, [...(byModel.get(model) || []), ms]);
    }
  }
  const models = Array.from(byModel.entries()).sort((a, b) => b[1].length - a[1].length);

  const disclosed = calls.filter(c => {
    const first = (c.turns || []).find(t => t.speaker === "agent");
    return first ? /\bAI\b/.test(first.text) : false;
  }).length;
  const liveWithoutAllergens = menu.filter(d => d.availableToday && !d.allergensListed).length;

  const scaleMax = Math.max(1500, Math.ceil(Math.max(0, ...totals) / 500) * 500);
  const ticks = [0, ...Array.from({ length: scaleMax / 500 }, (_, i) => (i + 1) * 500)];

  return (
    <div className="page page-narrow">
      <PageHead title="Insights" sub="How the receptionist is doing, worked out from every call in the log." />

      {loading ? (
        <SkeletonRows count={5} />
      ) : total === 0 ? (
        <div className="group">
          <Empty title="No calls yet" body="Make a test call or ring the restaurant's number. Numbers appear here once calls are logged." />
        </div>
      ) : (
        <>
          <Section title="Calls" meta={plural(total, "call")}>
            <div className="group">
              <Kv label="Booked a table" value={share(booked, total)} detail={`${booked} of ${total}`} />
              <Kv label="Transferred to staff" value={share(transferred, total)} detail={`${transferred} of ${total}`} />
              <Kv label="Took a message" value={share(messages, total)} detail={`${messages} of ${total}`} />
              <Kv label="Caller hung up or call failed" value={share(endedEarly, total)} detail={`${endedEarly} of ${total}`} />
            </div>
          </Section>

          <Section
            title="Response time"
            meta={totals.length ? plural(totals.length, "timed turn") : undefined}
            foot={`From the moment the caller stops speaking to the first audio of the reply. The target is under ${LATENCY_BUDGET_MS} ms at the median.`}
          >
            <div className="group">
              {totals.length === 0 ? (
                <Empty title="No timed turns yet" body="Calls log per-turn timings once the agent reports them." />
              ) : (
                <>
                  <Kv label="Median" value={`${p50} ms`} over={(p50 ?? 0) > LATENCY_BUDGET_MS} />
                  <Kv label="95th percentile" value={`${p95} ms`} over={(p95 ?? 0) > LATENCY_BUDGET_MS} />
                  <Kv label={`Within ${LATENCY_BUDGET_MS} ms`} value={share(within, totals.length)} detail={`${within} of ${totals.length} turns`} />
                  <div className="kv" style={{ display: "block", paddingBottom: 6 }}>
                    <span className="kv-label">
                      Every turn
                      <small>Each dot is one reply; the line marks the {LATENCY_BUDGET_MS} ms budget.</small>
                    </span>
                    <div className="dotplot" style={{ margin: "10px 0 0" }} aria-hidden="true">
                      <span className="dotplot-line" />
                      {totals.map((t, i) => (
                        <span
                          key={i}
                          className={`dotplot-dot${t > LATENCY_BUDGET_MS ? " is-over" : ""}`}
                          style={{ left: `${(Math.min(t, scaleMax) / scaleMax) * 100}%` }}
                        />
                      ))}
                      <span className="dotplot-budget" style={{ left: `${(LATENCY_BUDGET_MS / scaleMax) * 100}%` }} />
                      {ticks.map(t => (
                        <span key={t} className="dotplot-label" style={{ left: `${(t / scaleMax) * 100}%` }}>
                          {t === 0 ? "0" : t >= 1000 ? `${t / 1000} s` : `${t}`}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </Section>

          {models.length > 0 && (
            <Section title="By model" foot="Median response time per language model, from the same calls.">
              <div className="group">
                {models.map(([model, values]) => {
                  const m = median(values) ?? 0;
                  return <Kv key={model} label={model} value={`${m} ms`} detail={plural(values.length, "turn")} over={m > LATENCY_BUDGET_MS} />;
                })}
              </div>
            </Section>
          )}

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
      <span className="kv-value">
        <strong className={over ? "text-red" : undefined}>{value}</strong>
      </span>
    </div>
  );
}
