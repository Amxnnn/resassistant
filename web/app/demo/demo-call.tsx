"use client";

import React from "react";
import { FlaskConical } from "lucide-react";
import { siteFonts } from "../_brand/fonts";
import { SiteNav } from "../_brand/site-nav";
import { LiveCallPhone, SUGGESTIONS } from "../_brand/live-call-phone";
import { useLiveCall } from "../_brand/use-live-call";

export function DemoCall() {
  const call = useLiveCall({ callerName: "Website demo caller" });
  const canType = call.phase === "listening" || call.phase === "thinking" || call.phase === "speaking";

  return (
    <div className={`site ${siteFonts}`}>
      <SiteNav page="demo" />
      <main className="demo">
        <div className="demo-phone">
          <LiveCallPhone call={call} frameless="sm" />
        </div>

        <div className="demo-copy">
          <p className="demo-note" role="note">
            <FlaskConical size={15} aria-hidden="true" />
            <span>
              <strong>Demo version, not the finished product.</strong> The receptionist is still being built and tuned, so now
              and then a reply may be slow or wrong.
            </span>
          </p>
          <h1 className="display-1 demo-title">Call The Saffron Table.</h1>
          <p className="lede">
            This is a live call to the AI receptionist, with the same voice and tools as a phone call. Press call, allow the
            microphone, and talk like a guest would. Cut in whenever you like.
          </p>

          <section className="asks" aria-labelledby="asks-title">
            <h2 id="asks-title" className="asks-title">
              Things to ask
            </h2>
            <div className="asks-list">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" className="ask" disabled={!canType} onClick={() => call.send(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="asks-hint">{canType ? "Say one, or tap it to send as text." : "Once the call connects, say one or tap it to send as text."}</p>
          </section>

          <p className="fineprint">
            The Saffron Table and its bookings are made up, so use a made-up name and number. Your voice goes to LiveKit and
            Deepgram to be understood, calls last up to five minutes, and each one is saved to the demo restaurant’s call log.
          </p>
        </div>
      </main>
    </div>
  );
}
