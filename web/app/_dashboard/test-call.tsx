"use client";

import React from "react";
import { PageHead } from "./ui";
import { CallConsole } from "../_brand/call-console";
import type { LiveCall } from "../_brand/use-live-call";

export function TestCall({ call }: { call: LiveCall }) {
  return (
    <div className="page page-narrow">
      <PageHead
        title="Test call"
        sub="A live call to the receptionist from your browser: the same agent, voice and tools as a phone call. When it ends, the call appears under Calls."
      />
      <CallConsole call={call} />
    </div>
  );
}
