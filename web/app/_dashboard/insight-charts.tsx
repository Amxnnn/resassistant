"use client";

import React, { useState } from "react";

/* The flat charts on Insights, drawn in HTML so they read as part of the grouped lists. Bars carry
   their value at the tip; columns carry theirs in a tooltip on hover or focus, and in their label
   for screen readers. Text stays in ink; only the marks wear colour. */

export type BarRow = {
  key: string;
  label: string;
  sub?: string;
  value: number;
  text: string;
  color: string;
  wash?: boolean; // a lighter fill: a stage that runs inside another
  target?: number;
};

/** Horizontal bars on one scale, one row each, with an optional target tick per row and an
 *  optional line through every row (the budget). */
export function BarRows({ rows, max, line }: { rows: BarRow[]; max: number; line?: number }) {
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  return (
    <div className="group bars">
      {rows.map(r => (
        <div key={r.key} className="bar-row">
          <p className="bar-label">
            {r.label}
            {r.sub && <small>{r.sub}</small>}
          </p>
          <div className="bar-plot">
            {line !== undefined && <span className="bar-line" style={{ left: pct(line) }} aria-hidden="true" />}
            <span
              className={`bar${r.wash ? " is-wash" : ""}`}
              style={{ width: r.value > 0 ? `max(${pct(r.value)}, 3px)` : 0, background: r.color }}
              aria-hidden="true"
            />
            {r.target !== undefined && <span className="bar-target" style={{ left: pct(r.target) }} aria-hidden="true" />}
            <span className="bar-value" style={{ left: pct(r.value) }}>
              {r.text}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export type DayColumn = { key: string; label: string; short: string; booked: number; other: number };

/** Calls per day, booked calls in the accent under the rest. */
export function CallsByDay({ days }: { days: DayColumn[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, ...days.map(d => d.booked + d.other));
  const step = top <= 4 ? 1 : top <= 10 ? 2 : top <= 25 ? 5 : 10;
  const max = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  const shown = hover !== null ? days[hover] : null;
  // Sparse day labels: the first, every seventh back from the last, and the last.
  const labelled = (i: number) => i === 0 || (days.length - 1 - i) % 7 === 0;

  return (
    <div className="group cols">
      <ul className="viz-legend cols-legend">
        <li>
          <i style={{ background: "var(--chart-booked)" }} aria-hidden="true" />
          Booked a table
        </li>
        <li>
          <i style={{ background: "var(--chart-rest)" }} aria-hidden="true" />
          Other calls
        </li>
      </ul>
      <div className="cols-plot">
        {ticks.map(t => (
          <span key={t} className="cols-tick" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden="true">
            <span>{t}</span>
          </span>
        ))}
        <div className="cols-row" onPointerLeave={() => setHover(null)}>
          {days.map((d, i) => {
            const total = d.booked + d.other;
            return (
              <button
                key={d.key}
                type="button"
                className={`col${hover === i ? " is-hover" : ""}${hover !== null && hover !== i ? " is-dim" : ""}`}
                aria-label={`${d.label}: ${total} call${total === 1 ? "" : "s"}, ${d.booked} booked`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span className="col-stack" style={{ height: `${(total / max) * 100}%` }}>
                  {d.booked > 0 && <i style={{ flexGrow: d.booked, background: "var(--chart-booked)" }} />}
                  {d.other > 0 && <i style={{ flexGrow: d.other, background: "var(--chart-rest)" }} />}
                </span>
              </button>
            );
          })}
        </div>
        {shown && hover !== null && (
          <div className="cols-tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }} aria-hidden="true">
            <p className="viz-tip-value">
              {shown.booked + shown.other} call{shown.booked + shown.other === 1 ? "" : "s"}
            </p>
            <p className="viz-tip-meta">
              {shown.label}, {shown.booked} booked
            </p>
          </div>
        )}
      </div>
      <div className="cols-x" aria-hidden="true">
        {days.map((d, i) => (
          <span key={d.key}>{labelled(i) ? d.short : ""}</span>
        ))}
      </div>
    </div>
  );
}
