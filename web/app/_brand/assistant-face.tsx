"use client";

import React, { useEffect, useRef } from "react";

export type FaceState = "idle" | "listening" | "thinking" | "speaking";

// Mouth centre and resting shapes, in the 200 × 200 face box.
const MX = 103;
const MY = 136;
const REST: Record<FaceState, string> = {
  idle: `M${MX - 17} ${MY - 2} Q${MX} ${MY + 11} ${MX + 17} ${MY - 2}`,
  listening: `M${MX - 12} ${MY} Q${MX} ${MY + 7} ${MX + 12} ${MY}`,
  thinking: `M${MX - 12} ${MY + 2} L${MX + 11} ${MY - 2}`,
  speaking: mouthPath(0.45, 15)
};

/** A closed lip shape: o is how open (0–1), w is half the width. */
function mouthPath(o: number, w: number) {
  const top = MY - 3 - 5 * o;
  const bottom = MY + 2 + 20 * o;
  return `M${MX - w} ${MY} Q${MX} ${top} ${MX + w} ${MY} Q${MX} ${bottom} ${MX - w} ${MY} Z`;
}

/**
 * The assistant: a line-drawn face wearing a receptionist's headset.
 * The saffron mic tip is the brand mark; the mouth moves while it speaks.
 */
export function AssistantFace({
  state = "idle",
  size = 200,
  followPointer = false,
  className = "",
  label = "The assistant",
  level
}: {
  state?: FaceState;
  size?: number;
  followPointer?: boolean;
  className?: string;
  label?: string;
  /** Live audio level (0–1) of the voice; when given, the mouth follows the real audio. */
  level?: () => number;
}) {
  const mouth = useRef<SVGPathElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const speaking = state === "speaking";

  // Lip-sync to the actual voice: openness follows the audio's loudness, frame by frame.
  useEffect(() => {
    const el = mouth.current;
    if (!el || !level) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let o = 0;
    const tick = () => {
      const target = Math.min(1, Math.max(0, (level() - 0.012) * 6));
      o += (target - o) * (target > o ? 0.55 : 0.3);
      const open = reduced ? (target > 0.05 ? 0.45 : 0) : o;
      if (open > 0.05) {
        el.setAttribute("d", mouthPath(open, 11 + open * 8));
        el.classList.add("is-open");
      } else {
        el.setAttribute("d", REST[state]);
        el.classList.remove("is-open");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, state]);

  // Without a live level: eased random openness, re-targeted every 70–140 ms.
  useEffect(() => {
    const el = mouth.current;
    if (!el || level) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!speaking || reduced) {
      el.setAttribute("d", REST[state]);
      return;
    }
    let raf = 0;
    let o = 0.2;
    let w = 14;
    let to = 0.7;
    let tw = 16;
    let next = 0;
    const tick = (t: number) => {
      if (t > next) {
        to = Math.random() < 0.18 ? 0.04 : 0.2 + Math.random() * 0.8;
        tw = 11 + Math.random() * 8 + to * 3;
        next = t + 70 + Math.random() * 70;
      }
      o += (to - o) * 0.38;
      w += (tw - w) * 0.3;
      el.setAttribute("d", mouthPath(o, w));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, speaking, level]);

  // Eyes drift toward the pointer.
  useEffect(() => {
    if (!followPointer || state === "thinking") {
      eyes.current?.style.removeProperty("transform");
      return;
    }
    let raf = 0;
    function onMove(e: PointerEvent) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const box = svg.current?.getBoundingClientRect();
        if (!box || !eyes.current) return;
        const dx = e.clientX - (box.left + box.width / 2);
        const dy = e.clientY - (box.top + box.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const pull = Math.min(1, d / 400) * 4;
        eyes.current.style.transform = `translate(${(dx / d) * pull}px, ${(dy / d) * pull}px)`;
      });
    }
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [followPointer, state]);

  return (
    <svg
      ref={svg}
      className={`face face-${state} ${className}`}
      width={size}
      height={size}
      viewBox="-20 -20 240 240"
      role="img"
      aria-label={`${label}, ${state}`}
    >
      <circle className="face-disc" cx="100" cy="100" r="92" />

      {/* thought dots */}
      <g className="face-think" aria-hidden="true">
        <circle cx="160" cy="18" r="5" />
        <circle cx="177" cy="4" r="7" />
        <circle cx="198" cy="-10" r="9" />
      </g>

      {/* headset band and ear cups */}
      <path className="face-line" d="M41 104 C 38 34, 162 34, 159 104" strokeWidth="6" />
      <rect className="face-ink" x="27" y="90" width="20" height="34" rx="9" />
      <rect className="face-ink" x="153" y="90" width="20" height="34" rx="9" />

      {/* brows */}
      <g className="face-brows">
        <path className="face-line face-brow-l" d="M65 80 Q76 71 88 77" strokeWidth="5.5" />
        <path className="face-line face-brow-r" d="M114 77 Q126 71 137 80" strokeWidth="5.5" />
      </g>

      {/* eyes */}
      <g className="face-eyes-wrap">
        <g ref={eyes} className="face-eyes">
          <circle className="face-ink face-eye" cx="78" cy="99" r="6.5" />
          <circle className="face-ink face-eye" cx="124" cy="99" r="6.5" />
        </g>
      </g>

      {/* nose */}
      <path className="face-line" d="M103 103 Q96 117 106 119" strokeWidth="4.5" />

      {/* mouth */}
      <path ref={mouth} className={`face-mouth${speaking && !level ? " is-open" : ""}`} d={REST[state]} />

      {/* mic boom and saffron tip */}
      <path className="face-line" d="M38 122 C 40 148, 56 156, 72 151" strokeWidth="4.5" />
      <circle className="face-mic" cx="77" cy="150" r="6.5" />

      {/* sound */}
      <g className="face-waves" aria-hidden="true">
        <path className="face-wave" d="M186 118 Q195 136 186 154" />
        <path className="face-wave" d="M200 108 Q213 136 200 164" />
      </g>
    </svg>
  );
}
