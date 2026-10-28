"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleAlert, Keyboard, Volume2 } from "lucide-react";
import { Orb, type OrbState } from "./orb";
import { IPhone } from "./iphone";
import { CallClock, CallHead, CallKey, CallLine, KeyIcons } from "./call-parts";
import type { LiveCall } from "./use-live-call";
import { RESTAURANT } from "../_dashboard/format";

export const SUGGESTIONS = [
  "Can I book a table for four tonight at 8?",
  "What vegetarian dishes do you have?",
  "Does the paneer tikka have nuts?",
  "Are you open on Mondays?",
  "Is there parking nearby?"
];

const STATUS: Record<string, string> = {
  idle: "Ready to call",
  connecting: "Connecting…",
  ringing: "Ringing…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  ended: "Call ended"
};

/* The mute key grows a ring with the caller's own voice, so they can see they're heard. */
function MuteKey({ call }: { call: LiveCall }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let raf = 0;
    let v = 0;
    const tick = () => {
      const target = call.muted ? 0 : Math.min(1, call.callerLevel() * 7);
      v += (target - v) * 0.35;
      ref.current?.style.setProperty("--lvl", v.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [call.muted, call.callerLevel]);

  return (
    <CallKey
      kind="glass"
      label={call.micReady ? "Mute" : "No mic"}
      pressed={call.micReady ? call.muted : undefined}
      onClick={call.toggleMute}
      disabled={!call.micReady}
      buttonRef={ref}
    >
      {call.muted || !call.micReady ? KeyIcons.muted : KeyIcons.mute}
    </CallKey>
  );
}

/** A real browser call to the receptionist, inside the phone. The orb follows the live voices. */
export function LiveCallPhone({ call, frameless }: { call: LiveCall; frameless?: "sm" }) {
  const { phase, live, lines, error, notice, elapsed, soundBlocked } = call;
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const canType = phase === "listening" || phase === "thinking" || phase === "speaking";
  const showCompose = canType && (typing || !call.micReady);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines, phase]);

  useEffect(() => {
    if (!live) setTyping(false);
  }, [live]);

  const orb: OrbState =
    phase === "speaking" ? "speaking" : phase === "thinking" ? "thinking" : phase === "listening" ? "listening" : "idle";
  const showClock = (live && phase !== "ringing") || (phase === "ended" && elapsed > 0);
  const empty =
    phase === "connecting"
      ? "Connecting the call…"
      : phase === "ringing"
        ? "Ringing the receptionist…"
        : "Press call and say hello. Ask for a table, a dish or the opening hours, and talk over it whenever you like.";

  return (
    <IPhone frameless={frameless} className="live-phone">
      <div className={`call${live ? " is-live" : ""}`}>
        <CallHead
          name={RESTAURANT.name}
          meta={
            <span aria-live="polite">
              {STATUS[phase]}
              {showClock && (
                <>
                  {" · "}
                  <CallClock seconds={elapsed} />
                </>
              )}
            </span>
          }
        />
        <Orb
          state={orb}
          level={call.agentLevel}
          inputLevel={call.muted ? undefined : call.callerLevel}
          className="call-orb"
          label="The receptionist"
        />

        {(error || notice) && (
          <p className={`call-alert${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
            <CircleAlert size={15} aria-hidden="true" />
            {error || notice}
          </p>
        )}

        <div ref={thread} className="call-thread is-scroll" aria-live="polite" aria-label="Transcript" tabIndex={0}>
          {lines.length === 0 ? (
            <p className="call-empty">{empty}</p>
          ) : (
            lines.map(l => (
              <CallLine
                key={l.id}
                turn={{ id: l.id, who: l.speaker, text: l.text.trim(), interim: !l.final, typed: l.typed }}
              />
            ))
          )}
        </div>

        {soundBlocked && (
          <button type="button" className="call-sound" onClick={call.enableSound}>
            <Volume2 size={15} aria-hidden="true" /> Turn on sound
          </button>
        )}

        {showCompose && (
          <form
            className="call-compose"
            onSubmit={e => {
              e.preventDefault();
              call.send(input);
              setInput("");
            }}
          >
            <label className="sr-only" htmlFor="caller-input">
              Type a message to the receptionist
            </label>
            <input
              id="caller-input"
              type="text"
              placeholder="Type instead of talking"
              value={input}
              onChange={e => setInput(e.target.value)}
              autoComplete="off"
              autoFocus={typing}
            />
            <button type="submit" aria-label="Send" disabled={!input.trim()}>
              <ArrowUp size={17} strokeWidth={2.6} />
            </button>
          </form>
        )}

        <div className="call-keys">
          {live ? (
            <>
              <MuteKey call={call} />
              <CallKey kind="glass" label="Type" pressed={showCompose} onClick={() => setTyping(t => !t)} disabled={!canType || !call.micReady}>
                <Keyboard strokeWidth={2} />
              </CallKey>
              <CallKey kind="end" label="End" onClick={call.end}>
                {KeyIcons.hangUp}
              </CallKey>
            </>
          ) : (
            <CallKey
              kind="start"
              label={phase === "connecting" ? "Calling" : phase === "ended" ? "Call again" : "Call"}
              onClick={call.start}
              disabled={phase === "connecting"}
            >
              {KeyIcons.phone}
            </CallKey>
          )}
        </div>
      </div>
    </IPhone>
  );
}
