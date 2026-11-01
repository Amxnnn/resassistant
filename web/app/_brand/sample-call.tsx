"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Grid3x3, Mic, Volume2 } from "lucide-react";
import { Orb, speechEnvelope, type OrbState } from "./orb";
import { IPhone } from "./iphone";
import { BookingCard, CallClock, CallHead, CallKey, CallLine, KeyIcons, type Facts, type Turn } from "./call-parts";

type Beat = { who: Turn["who"]; text: string; facts?: Facts };

// A sample call, scripted. The restaurant and the guest are made up.
const SCRIPT: Beat[] = [
  { who: "agent", text: "Thanks for calling The Saffron Table. I’m the restaurant’s AI assistant. How can I help?" },
  { who: "caller", text: "Hi! Do you have a table for four tonight, around eight?", facts: { party: "Table for 4", day: "Tonight" } },
  { who: "check", text: "Checking tables for 4, tonight at 8 PM" },
  { who: "agent", text: "Eight’s taken, but seven forty-five and eight thirty are free. Which would you like?" },
  { who: "caller", text: "Eight thirty, please. Does the paneer tikka have nuts?", facts: { time: "8:30 PM" } },
  { who: "agent", text: "It lists dairy. Nuts aren’t listed, but with a serious allergy, check with staff when you arrive. What name is it under?" },
  { who: "caller", text: "Priya.", facts: { name: "Priya" } },
  { who: "agent", text: "Table for 4, tonight at 8:30 PM, for Priya. Shall I book it?" },
  { who: "caller", text: "Yes, please." },
  { who: "check", text: "Booking 4 guests at 8:30 PM" },
  { who: "agent", text: "You’re booked. Your code is K7Q2.", facts: { code: "K7Q2" } }
];

/** The beats each step of the story plays, [from, to), and the call's clock when it starts. */
export const STEP_BEATS: { beats: [number, number]; at: number }[] = [
  { beats: [0, 1], at: 0 },
  { beats: [1, 2], at: 6 },
  { beats: [2, 6], at: 11 },
  { beats: [6, SCRIPT.length], at: 29 }
];

function factsUpTo(n: number): Facts {
  return SCRIPT.slice(0, n).reduce<Facts>((acc, b) => ({ ...acc, ...b.facts }), {});
}

/**
 * The sample call inside the phone. step -1 plays the whole call on a loop;
 * 0–3 replays just that step of the story, with everything before it already said.
 */
export function SampleCall({ step = -1 }: { step?: number }) {
  const [done, setDone] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [orb, setOrb] = useState<OrbState>("idle");
  const [seconds, setSeconds] = useState(0);
  const guestVoice = useMemo(() => speechEnvelope(), []);

  useEffect(() => {
    let alive = true;
    const pause = (ms: number) => new Promise<boolean>(r => setTimeout(() => r(alive), ms));
    const reset = (to: number, clock: number) => {
      setDone(to);
      setActive(null);
      setPartial(null);
      setSeconds(clock);
    };

    async function say(i: number) {
      const beat = SCRIPT[i];
      setActive(i);
      setPartial(null);
      if (beat.who === "check") {
        setOrb("thinking");
        if (!(await pause(1300))) return false;
      } else {
        if (beat.who === "agent" && SCRIPT[i - 1]?.who === "caller") {
          setOrb("thinking");
          if (!(await pause(450))) return false;
        }
        setOrb(beat.who === "agent" ? "speaking" : "listening");
        const words = beat.text.split(" ");
        for (let w = 1; w <= words.length; w++) {
          setPartial(words.slice(0, w).join(" "));
          if (!(await pause(beat.who === "agent" ? 165 : 125))) return false;
        }
        if (!(await pause(beat.who === "agent" ? 450 : 350))) return false;
      }
      setDone(i + 1);
      setActive(null);
      setPartial(null);
      return true;
    }

    const clock = setInterval(() => setSeconds(s => s + 1), 1000);

    (async () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        reset(step < 0 ? SCRIPT.length : STEP_BEATS[step].beats[1], step < 0 ? 52 : STEP_BEATS[step].at + 4);
        setOrb("idle");
        clearInterval(clock);
        return;
      }
      if (step >= 0) {
        const { beats, at } = STEP_BEATS[step];
        reset(beats[0], at);
        for (let i = beats[0]; i < beats[1]; i++) if (!(await say(i))) return;
        setOrb("idle");
        return;
      }
      while (alive) {
        reset(0, 0);
        setOrb("idle");
        if (!(await pause(700))) return;
        for (let i = 0; i < SCRIPT.length; i++) if (!(await say(i))) return;
        setOrb("idle");
        if (!(await pause(4200))) return;
      }
    })();

    return () => {
      alive = false;
      clearInterval(clock);
    };
  }, [step]);

  const turns: Turn[] = SCRIPT.slice(0, done).map((b, i) => ({ id: String(i), who: b.who, text: b.text, done: true }));
  if (active !== null) {
    const b = SCRIPT[active];
    if (b.who === "check") turns.push({ id: String(active), who: "check", text: b.text });
    else if (partial) turns.push({ id: String(active), who: b.who, text: partial, interim: b.who === "caller" });
  }
  const facts = factsUpTo(done);
  const hasFacts = Object.keys(facts).length > 0;

  return (
    <IPhone className="sample-phone">
      <div className="call">
        <CallHead
          name="The Saffron Table"
          meta={
            <>
              AI receptionist · <CallClock seconds={seconds} />
            </>
          }
        />
        <Orb state={orb} inputLevel={guestVoice} className="call-orb" label="The receptionist" />
        <div className="call-thread is-sample">
          {turns.map(t => (
            <CallLine key={t.id} turn={t} />
          ))}
        </div>
        <div className="call-spacer" />
        <div className={`call-pass${hasFacts ? " is-shown" : ""}`}>{hasFacts && <BookingCard facts={facts} />}</div>
        <div className="call-keys">
          <CallKey kind="glass" label="Speaker" decorative>
            <Volume2 strokeWidth={2} />
          </CallKey>
          <CallKey kind="glass" label="Mute" decorative>
            <Mic strokeWidth={2} />
          </CallKey>
          <CallKey kind="glass" label="Keypad" decorative>
            <Grid3x3 strokeWidth={2} />
          </CallKey>
          <CallKey kind="end" label="End" decorative>
            {KeyIcons.hangUp}
          </CallKey>
        </div>
      </div>
    </IPhone>
  );
}
