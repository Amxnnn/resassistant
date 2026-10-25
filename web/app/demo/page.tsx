"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AssistantFace } from "../_brand/assistant-face";
import { BRAND } from "../_brand/brand";
import { CallConsole } from "../_brand/call-console";
import { useLiveCall } from "../_brand/use-live-call";

export default function DemoPage() {
  const call = useLiveCall({ callerName: "Website demo caller" });

  useEffect(() => {
    document.title = `Demo call · ${BRAND.name}`;
  }, []);

  return (
    <div className="demo">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Link href="/" className="lp-logo">
            <AssistantFace size={30} label={BRAND.name} />
            <span>{BRAND.name}</span>
          </Link>
          <div className="lp-nav-actions">
            <Link href="/" className="btn btn-quiet lp-signin">
              <ArrowLeft size={15} /> Home
            </Link>
            <Link href="/login" className="btn btn-secondary">
              Staff sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="page page-narrow demo-page">
        <header className="demo-head">
          <h1 className="large-title">Call the demo restaurant</h1>
          <p className="page-sub" style={{ marginInline: "auto" }}>
            This is a live call to the real receptionist. Press call, allow the microphone, and talk like a guest would.
          </p>
        </header>

        <CallConsole call={call} faceSize={180} />

        <p className="demo-note">
          The Saffron Table and its bookings are made up, so use a made-up name and number. Your voice goes to LiveKit and
          Deepgram to be understood, calls last up to five minutes, and each one is saved to the demo restaurant's call log.
        </p>
      </main>
    </div>
  );
}
