"use client";

import React, { useState } from "react";
import { Monitor, Phone } from "lucide-react";
import type { Call, Latency, SheetState, Turn } from "./types";
import {
  dateKey,
  dayLabel,
  formatDuration,
  formatPhone,
  formatTime,
  LATENCY_BUDGET_MS,
  median,
  OUTCOME_DOT,
  OUTCOME_LABEL,
  plural
} from "./format";
import { Chevron, Empty, PageHead, Section, Segmented, SkeletonRows, Status } from "./ui";

type Filter = "all" | "booked" | "handoff" | "ended";

const FILTER_OUTCOMES: Record<Exclude<Filter, "all">, string[]> = {
  booked: ["booked", "changed"],
  handoff: ["transferred", "message_taken"],
  ended: ["hung_up", "failed"]
};

export const LANGUAGE_NAME: Record<string, string> = { en: "English", hi: "Hindi" };

export function callTitle(c: Call) {
  return c.callerNumber ? formatPhone(c.callerNumber) : c.channel === "browser" ? "Browser test call" : "Unknown caller";
}

export function turnTotals(turns: Turn[] = []) {
  return turns.map(t => t.latency?.total_ms).filter((n): n is number => typeof n === "number");
}

export function Calls({
  calls,
  now,
  loading,
  onOpen
}: {
  calls: Call[];
  now: Date;
  loading: boolean;
  onOpen: (sheet: SheetState) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const today = dateKey(now);
  const list = calls
    .filter(c => filter === "all" || FILTER_OUTCOMES[filter].includes(c.outcome))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const groups: { key: string; items: Call[] }[] = [];
  for (const c of list) {
    const key = dateKey(c.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(c);
    else groups.push({ key, items: [c] });
  }

  return (
    <div className="page">
      <PageHead title="Calls" sub="Every call the receptionist took, with the transcript and how fast it answered on each turn." />

      <div className="toolbar">
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "booked", label: "Booked" },
            { id: "handoff", label: "Handed to staff" },
            { id: "ended", label: "Ended early" }
          ]}
        />
      </div>

      {loading ? (
        <SkeletonRows count={5} />
      ) : groups.length === 0 ? (
        <div className="group">
          <Empty
            title="No calls here"
            body={filter === "all" ? "Calls appear here when they end, with the full transcript." : "No calls in the log ended this way."}
          />
        </div>
      ) : (
        groups.map(g => (
          <Section key={g.key} title={dayLabel(g.key, today)} meta={plural(g.items.length, "call")}>
            <div className="group">
              {g.items.map(c => {
                const p50 = median(turnTotals(c.turns));
                const duration = new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();
                return (
                  <button key={c.id} type="button" className="row row-has-lead" onClick={() => onOpen({ kind: "call", id: c.id })}>
                    <span className="row-lead">{c.channel === "browser" ? <Monitor size={17} /> : <Phone size={17} />}</span>
                    <span className="row-main">
                      <span className="row-title" style={{ display: "block" }}>
                        {callTitle(c)}
                      </span>
                      <span className="row-sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Status dot={OUTCOME_DOT[c.outcome]}>{OUTCOME_LABEL[c.outcome] || c.outcome}</Status>
                        <span className="row-hide-sm">
                          · {formatDuration(duration)} · {LANGUAGE_NAME[c.language] || c.language.toUpperCase()}
                        </span>
                      </span>
                    </span>
                    <span className="row-trail">
                      {p50 !== null && (
                        <span className={p50 > LATENCY_BUDGET_MS ? "text-red" : undefined} title="Median response time">
                          {p50} ms
                        </span>
                      )}
                      <span className="row-hide-sm" style={{ minWidth: 62, textAlign: "right" }}>
                        {formatTime(c.startedAt)}
                      </span>
                      <Chevron />
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        ))
      )}
    </div>
  );
}

/* Stage breakdown of one turn, scaled so the bar's length is the turn's total time. */
export function LatencyBar({ latency, scale }: { latency: Latency; scale: number }) {
  const total = latency.total_ms || 0;
  const parts = [
    { key: "eou", ms: latency.eou_ms || 0 },
    { key: "stt", ms: latency.stt_ms || 0 },
    { key: "llm", ms: latency.llm_ttft_ms || 0 },
    { key: "tts", ms: latency.tts_ttfb_ms || 0 }
  ];
  const sum = parts.reduce((s, p) => s + p.ms, 0) || 1;
  const barWidth = Math.min(100, (total / scale) * 100);
  return (
    <div className="latency-bar" aria-hidden="true">
      <div style={{ display: "flex", width: `${barWidth}%`, borderRadius: 3, overflow: "hidden" }}>
        {parts.map(p => (
          <i key={p.key} className={`seg-${p.key}`} style={{ width: `${(p.ms / sum) * 100}%` }} />
        ))}
      </div>
      <span className="latency-budget" style={{ left: `${(LATENCY_BUDGET_MS / scale) * 100}%` }} />
    </div>
  );
}

export function LatencyLegend() {
  return (
    <div className="latency-legend">
      <span><i className="seg-eou" /> End of turn</span>
      <span><i className="seg-stt" /> Speech to text</span>
      <span><i className="seg-llm" /> Model first token</span>
      <span><i className="seg-tts" /> First audio</span>
      <span><i style={{ width: 2, height: 10, background: "var(--label-2)" }} /> {LATENCY_BUDGET_MS} ms budget</span>
    </div>
  );
}
