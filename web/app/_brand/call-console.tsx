"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleAlert, Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import { AssistantFace, type FaceState } from "./assistant-face";
import type { LiveCall } from "./use-live-call";
import { RESTAURANT } from "../_dashboard/format";

const SUGGESTIONS = [
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

/* The mute button grows a ring with the caller's own voice, so they can see they're heard. */
function MicButton({ call }: { call: LiveCall }) {
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
    <div className="call-control">
      <button
        ref={ref}
        type="button"
        className="call-btn call-btn-mic"
        aria-pressed={call.muted}
        aria-label={call.muted ? "Unmute" : "Mute"}
        onClick={call.toggleMute}
        disabled={!call.micReady}
      >
        {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
      </button>
      {!call.micReady ? "No mic" : call.muted ? "Muted" : "Mute"}
    </div>
  );
}

export function CallConsole({ call, faceSize = 148 }: { call: LiveCall; faceSize?: number }) {
  const { phase, live, lines, error, notice, elapsed, soundBlocked } = call;
  const [input, setInput] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const canType = phase === "listening" || phase === "thinking" || phase === "speaking";

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const face: FaceState =
    phase === "speaking" ? "speaking" : phase === "thinking" ? "thinking" : phase === "listening" ? "listening" : "idle";
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const showClock = (live && phase !== "ringing") || (phase === "ended" && elapsed > 0);

  const emptyCopy =
    phase === "connecting"
      ? "Connecting the call…"
      : phase === "ringing"
        ? "Ringing the receptionist…"
        : "Press call and say hello. Ask for a table, a dish or the opening hours, and talk over it whenever you like.";

  return (
    <div className="console">
      <div className="group">
        <div className="call-card">
          <AssistantFace state={face} size={faceSize} followPointer level={call.agentLevel} label="The receptionist" />
          <div className="call-name">{RESTAURANT.name}</div>
          <div className={`call-status${phase === "speaking" ? " is-speaking" : ""}`} aria-live="polite">
            {STATUS[phase]}
            {showClock ? ` · ${clock}` : ""}
          </div>

          {soundBlocked && (
            <button type="button" className="btn btn-secondary call-sound" onClick={call.enableSound}>
              <Volume2 size={16} /> Turn on sound
            </button>
          )}

          <div className="call-controls">
            {live ? (
              <>
                <MicButton call={call} />
                <div className="call-control">
                  <button type="button" className="call-btn call-btn-end" aria-label="End call" onClick={call.end}>
                    <PhoneOff size={22} />
                  </button>
                  End
                </div>
              </>
            ) : (
              <div className="call-control">
                <button
                  type="button"
                  className="call-btn call-btn-start"
                  aria-label={phase === "ended" ? "Call again" : "Start call"}
                  onClick={call.start}
                  disabled={phase === "connecting"}
                >
                  <Phone size={22} />
                </button>
                {phase === "connecting" ? "Calling" : phase === "ended" ? "Call again" : "Call"}
              </div>
            )}
          </div>

          {(error || notice) && (
            <p className={`call-alert${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
              <CircleAlert size={15} aria-hidden="true" />
              {error || notice}
            </p>
          )}
        </div>

        <div className="console-thread">
          <div ref={thread} className="thread" aria-live="polite" aria-label="Transcript">
            {lines.length === 0 ? (
              <p className="thread-empty">{emptyCopy}</p>
            ) : (
              lines.map(l => (
                <div
                  key={l.id}
                  className={`bubble-wrap${l.speaker === "caller" ? " is-caller" : ""}${l.final ? "" : " is-interim"}`}
                >
                  <div className="bubble">{l.text.trim()}</div>
                  {l.typed && <span className="bubble-meta">Typed</span>}
                </div>
              ))
            )}
            {phase === "thinking" && (
              <div className="bubble-wrap">
                <div className="bubble typing" aria-label="The receptionist is thinking">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
          </div>

          <form
            className="composer"
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
              placeholder={canType ? "Or type instead of talking" : "Start a call to talk or type"}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={!canType}
              autoComplete="off"
            />
            <button type="submit" className="send-btn" aria-label="Send" disabled={!canType || !input.trim()}>
              <ArrowUp size={18} strokeWidth={2.6} />
            </button>
          </form>
        </div>
      </div>

      <section className="section">
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
  );
}
