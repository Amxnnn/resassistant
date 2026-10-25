"use client";

import React, { useEffect, useState } from "react";
import { AssistantFace, type FaceState } from "./assistant-face";

type Line = { who: "guest" | "agent"; text: string };

// Sample call, played on a loop. The restaurant and guest are fictional.
const SCRIPT: Line[] = [
  { who: "agent", text: "Thanks for calling The Saffron Table. I'm the restaurant's AI assistant. How can I help?" },
  { who: "guest", text: "Hi! Do you have a table for four tonight, around eight?" },
  { who: "agent", text: "Let me check. Eight is taken, but I have 7:45 or 8:30 for four. Which would you like?" },
  { who: "guest", text: "8:30, please. Does the paneer tikka have nuts?" },
  { who: "agent", text: "It lists dairy, no nuts. You're booked: four guests, tonight at 8:30. Your code is K7Q2." }
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function HeroConversation() {
  const [shown, setShown] = useState<Line[]>([]);
  const [partial, setPartial] = useState<string | null>(null);
  const [face, setFace] = useState<FaceState>("idle");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(SCRIPT.slice(-3));
      return;
    }
    let alive = true;
    (async () => {
      while (alive) {
        setShown([]);
        for (const line of SCRIPT) {
          if (!alive) return;
          if (line.who === "guest") {
            setFace("listening");
            await sleep(500);
            setShown(s => [...s, line]);
            await sleep(1500);
          } else {
            if (line !== SCRIPT[0]) {
              setFace("thinking");
              await sleep(800);
            }
            setFace("speaking");
            const words = line.text.split(" ");
            for (let i = 1; i <= words.length && alive; i++) {
              setPartial(words.slice(0, i).join(" "));
              await sleep(190);
            }
            setPartial(null);
            setShown(s => [...s, line]);
            setFace("idle");
            await sleep(700);
          }
        }
        await sleep(3200);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = shown.slice(partial !== null ? -2 : -3);

  return (
    <div className="hero-stage" aria-label="A sample call with the receptionist">
      <AssistantFace state={face} size={232} followPointer className="hero-face" label="Hostline receptionist" />
      <div className="hero-thread" aria-hidden="true">
        {visible.map((l, i) => (
          <div key={`${l.text}-${i}`} className={`bubble-wrap${l.who === "guest" ? " is-caller" : ""}`}>
            <div className="bubble">{l.text}</div>
          </div>
        ))}
        {partial !== null && (
          <div className="bubble-wrap">
            <div className="bubble">{partial}</div>
          </div>
        )}
      </div>
    </div>
  );
}
