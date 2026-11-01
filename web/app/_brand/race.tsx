"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

// Hours on the axis: 7 PM to 11 PM. A bar's position is its start and end in hours after 7.
const AXIS = ["7 PM", "8", "9", "10", "11"];

/**
 * Two calls race for the same table. The database rule lets one booking in and rejects the overlap;
 * the losing caller hears the next free time. Plays once when it scrolls into view.
 */
export function RaceFigure() {
  const ref = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);

  // The finished race is the default; with motion allowed it resets, then plays on sight.
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setArmed(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPlaying(true);
          io.disconnect();
        }
      },
      { threshold: 0.45 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <figure ref={ref} className={`race${armed && !playing ? " is-armed" : ""}${playing ? " is-playing" : ""}`}>
      <div className="race-head">
        <span>Table T4 · seats 4</span>
        <span>Friday</span>
      </div>
      <div className="race-axis" aria-hidden="true">
        {AXIS.map((t, i) => (
          <span key={t} className="num" style={{ left: `${(i / (AXIS.length - 1)) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      <div className="race-lanes">
        <div className="race-lane">
          <span className="race-who">Call A</span>
          <span className="race-track">
            <span className="race-bar is-won" style={{ "--from": 1, "--to": 2.5 } as React.CSSProperties}>
              <Check size={13} strokeWidth={2.8} aria-hidden="true" />
              <span className="num">8:00–9:30 PM</span>
            </span>
          </span>
        </div>
        <div className="race-lane">
          <span className="race-who">Call B</span>
          <span className="race-track">
            <span className="race-bar is-lost" style={{ "--from": 1.5, "--to": 3 } as React.CSSProperties}>
              <X size={13} strokeWidth={2.8} aria-hidden="true" />
              <span className="num">8:30–10:00 PM</span>
            </span>
          </span>
          <code className="race-code">slot_taken</code>
        </div>
      </div>
      <blockquote className="race-say">“That time was just booked. 9:30 PM is free.”</blockquote>
      <figcaption>
        Two calls ask for the same table at once. The database lets one booking in; the other caller hears the next free time.
      </figcaption>
    </figure>
  );
}
