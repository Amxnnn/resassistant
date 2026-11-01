"use client";

import React, { useEffect, useState } from "react";

/** The phone's own clock, in the viewer's time, so the mockup reads as their phone. */
function useClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    const tick = () => setNow(fmt.format(new Date()).replace(/\s?[AP]M$/i, ""));
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function StatusBar() {
  const time = useClock();
  return (
    <div className="iphone-status" aria-hidden="true">
      <span className="iphone-time">{time}</span>
      <span className="iphone-glyphs">
        <svg viewBox="0 0 18 12" className="iphone-glyph">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" className="iphone-glyph">
          <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4C5.2.4 2.6 1.4.5 3.4l1.2 1.3A8.9 8.9 0 0 1 8 2.2Z" />
          <path d="M8 5.6c1.5 0 2.9.6 4 1.6l1.2-1.3A7.6 7.6 0 0 0 8 3.8c-2 0-3.8.7-5.2 2.1L4 7.2a5.8 5.8 0 0 1 4-1.6Z" />
          <path d="M8 9.1c.6 0 1.1.2 1.6.6L8 11.6 6.4 9.7c.5-.4 1-.6 1.6-.6Z" />
        </svg>
        <svg viewBox="0 0 27 12" className="iphone-glyph iphone-battery">
          <rect x="0.5" y="0.5" width="23" height="11" rx="3.2" fill="none" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="16.5" height="8" rx="1.8" />
          <path d="M25 4v4a2.2 2.2 0 0 0 0-4Z" opacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

/**
 * A clean iPhone: titanium band, black bezel, Dynamic Island and home indicator.
 * Everything inside is sized in points of a 393 × 852 screen, so it scales as one object.
 * frameless="sm" drops the device on small screens, where the call fills the real phone instead.
 */
export function IPhone({
  children,
  className = "",
  frameless
}: {
  children: React.ReactNode;
  className?: string;
  frameless?: "sm";
}) {
  return (
    <div className={`iphone${frameless ? " is-frameless-sm" : ""} ${className}`}>
      <div className="iphone-body">
        <span className="iphone-key iphone-key-action" aria-hidden="true" />
        <span className="iphone-key iphone-key-up" aria-hidden="true" />
        <span className="iphone-key iphone-key-down" aria-hidden="true" />
        <span className="iphone-key iphone-key-power" aria-hidden="true" />
        <div className="iphone-screen">
          <StatusBar />
          <span className="iphone-island" aria-hidden="true" />
          {children}
          <span className="iphone-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
