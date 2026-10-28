"use client";

import React from "react";
import { PageHead } from "./ui";
import { siteFonts } from "../_brand/fonts";
import { LiveCallPhone, SUGGESTIONS } from "../_brand/live-call-phone";
import type { LiveCall } from "../_brand/use-live-call";

export function TestCall({ call }: { call: LiveCall }) {
  const canType = call.phase === "listening" || call.phase === "thinking" || call.phase === "speaking";
  return (
    <div className="page">
      <PageHead
        title="Test call"
        sub="A live call to the receptionist from your browser: the same agent, voice and tools as a phone call. When it ends, the call appears under Calls."
      />
      <div className={`testcall ${siteFonts}`}>
        <LiveCallPhone call={call} />
        <section className="section testcall-asks">
          <div className="section-head">
            <h2 className="section-title">Things to ask</h2>
            <span className="section-meta">Say one, or tap to send it as text</span>
          </div>
          <div className="chips">
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" className="chip chip-suggest" disabled={!canType} onClick={() => call.send(s)}>
                {s}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
