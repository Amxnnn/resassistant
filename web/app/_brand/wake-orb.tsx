"use client";

import React, { useEffect, useRef, useState } from "react";
import { Orb } from "./orb";

/** The closing orb. It leans in to listen while a call button under it is hovered or focused. */
export function WakeOrb({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (e: Event) => {
      if ((e.target as HTMLElement).closest?.("[data-wake]")) setAwake(true);
    };
    const off = (e: Event) => {
      if ((e.target as HTMLElement).closest?.("[data-wake]")) setAwake(false);
    };
    el.addEventListener("pointerover", on);
    el.addEventListener("pointerout", off);
    el.addEventListener("focusin", on);
    el.addEventListener("focusout", off);
    return () => {
      el.removeEventListener("pointerover", on);
      el.removeEventListener("pointerout", off);
      el.removeEventListener("focusin", on);
      el.removeEventListener("focusout", off);
    };
  }, []);

  return (
    <div ref={ref} className="close-stage">
      <Orb state={awake ? "listening" : "idle"} className="close-orb" label="The receptionist" />
      {children}
    </div>
  );
}
