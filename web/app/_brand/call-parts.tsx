"use client";

import React from "react";
import { Check, LoaderCircle, Mic, MicOff, Phone } from "lucide-react";

/** The call screen's header: who you called, and the call's state and time. */
export function CallHead({ name, meta, as: Tag = "p" }: { name: string; meta: React.ReactNode; as?: "h1" | "h2" | "p" }) {
  return (
    <div className="call-head">
      <Tag className="call-name">{name}</Tag>
      <p className="call-meta">{meta}</p>
    </div>
  );
}

/** A clock that keeps its digits in place: m:ss in fixed-width figures. */
export function CallClock({ seconds }: { seconds: number }) {
  return <span className="num">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>;
}

export type Turn = { id: string; who: "agent" | "caller" | "check"; text: string; done?: boolean; interim?: boolean; typed?: boolean };

/** One line of the call: the receptionist on the left, the caller on the right, a lookup in between. */
export function CallLine({ turn }: { turn: Turn }) {
  if (turn.who === "check") {
    return (
      <div className="call-line is-check">
        {turn.done ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : <LoaderCircle size={13} className="spin" aria-hidden="true" />}
        <span>{turn.text}</span>
      </div>
    );
  }
  return (
    <div className={`call-line${turn.who === "caller" ? " is-caller" : ""}${turn.interim ? " is-interim" : ""}`}>
      <span className="call-say">{turn.text}</span>
      {turn.typed && <span className="call-tag">Typed</span>}
    </div>
  );
}

export type Facts = { party?: string; day?: string; time?: string; name?: string; code?: string };

/** The booking as it's being made: every fact has a fixed slot and stays once it lands. */
export function BookingCard({ facts }: { facts: Facts }) {
  const slot = (value: string | undefined, label: string) => (
    <span className={`pass-fact${value ? " is-set" : ""}`}>
      <span className="pass-label">{label}</span>
      <span className="pass-value" key={value ?? "empty"}>
        {value ?? "—"}
      </span>
    </span>
  );
  return (
    <div className={`pass${facts.code ? " is-confirmed" : ""}`}>
      <div className="pass-top">
        <span className="pass-state">
          <i aria-hidden="true" />
          {facts.code ? "Confirmed" : "Taking details"}
        </span>
        <span className="pass-where">The Saffron Table</span>
      </div>
      <p className="pass-title" key={facts.party ?? "party"}>
        {facts.party ?? "Table for —"}
      </p>
      <div className="pass-facts">
        {slot(facts.day, "Day")}
        {slot(facts.time, "Time")}
        {slot(facts.name, "Name")}
        {slot(facts.code, "Code")}
      </div>
    </div>
  );
}

/** A round in-call button with its label underneath, as on the iPhone. */
export function CallKey({
  kind,
  label,
  onClick,
  pressed,
  disabled,
  decorative,
  children,
  buttonRef
}: {
  kind: "glass" | "end" | "start";
  label: string;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  decorative?: boolean;
  children: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  if (decorative) {
    return (
      <span className="call-key" aria-hidden="true">
        <span className={`call-key-btn is-${kind}`}>{children}</span>
        <span className="call-key-label">{label}</span>
      </span>
    );
  }
  return (
    <span className="call-key">
      <button
        ref={buttonRef}
        type="button"
        className={`call-key-btn is-${kind}`}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
      <span className="call-key-label" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

export const KeyIcons = {
  mute: <Mic strokeWidth={2} />,
  muted: <MicOff strokeWidth={2} />,
  phone: <Phone strokeWidth={2} fill="currentColor" />,
  hangUp: <Phone strokeWidth={2} fill="currentColor" className="hang-up" />
};
