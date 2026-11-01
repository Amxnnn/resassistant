"use client";

import React, { useEffect, useRef } from "react";

/**
 * Hover motion for the outcome cards (GSAP): each card tilts toward the pointer, lifts, and carries
 * a light that follows the cursor; it springs back on leave. The booked and message cards' rust glow
 * rises, and the handoff card's rings send out a ripple, the call being passed on.
 */
export function BentoMotion({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let cleanup = () => {};

    import("gsap").then(({ gsap }) => {
      if (cancelled) return;
      const offs = Array.from(root.querySelectorAll<HTMLElement>(".outcome")).map(card => {
        const title = card.querySelector<HTMLElement>(".outcome-title");
        const rings = Array.from(card.querySelectorAll<HTMLElement>(".outcome-rings i:not(.ripple)"));
        const ripple = card.querySelector<HTMLElement>(".outcome-rings i.ripple");
        const restRotation = rings.map(r => Number(gsap.getProperty(r, "rotation")) || 0);
        let wave: ReturnType<typeof gsap.fromTo> | null = null;

        gsap.set(card, { transformPerspective: 1100 });
        const tiltX = gsap.quickTo(card, "rotationX", { duration: 0.7, ease: "power3.out" });
        const tiltY = gsap.quickTo(card, "rotationY", { duration: 0.7, ease: "power3.out" });
        const lightX = gsap.quickSetter(card, "--mx", "%");
        const lightY = gsap.quickSetter(card, "--my", "%");

        const enter = () => {
          gsap.to(card, { y: -6, "--spot": 1, "--glow": 1, duration: 0.55, ease: "power3.out", overwrite: "auto" });
          if (title) gsap.to(title, { y: -3, duration: 0.6, ease: "power3.out", overwrite: "auto" });
          if (rings.length) {
            gsap.to(rings, { rotation: i => restRotation[i] + (i ? 8 : -8), scale: 1.04, duration: 0.9, ease: "power3.out", overwrite: "auto" });
          }
          if (ripple) {
            wave = gsap.fromTo(
              ripple,
              { scale: 1, opacity: 0.55 },
              { scale: 1.32, opacity: 0, duration: 1.7, ease: "power2.out", repeat: -1, repeatDelay: 0.15 }
            );
          }
        };
        const move = (e: PointerEvent) => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          tiltY((px - 0.5) * 7);
          tiltX((0.5 - py) * 5);
          lightX(px * 100);
          lightY(py * 100);
        };
        const leave = () => {
          tiltX(0);
          tiltY(0);
          gsap.to(card, { y: 0, duration: 0.9, ease: "elastic.out(1, 0.6)", overwrite: "auto" });
          gsap.to(card, { "--spot": 0, "--glow": 0, duration: 0.5, ease: "power2.out" });
          if (title) gsap.to(title, { y: 0, duration: 0.7, ease: "power3.out", overwrite: "auto" });
          if (rings.length) gsap.to(rings, { rotation: i => restRotation[i], scale: 1, duration: 0.9, ease: "power3.out", overwrite: "auto" });
          wave?.kill();
          wave = null;
          if (ripple) gsap.to(ripple, { opacity: 0, duration: 0.3 });
        };

        card.addEventListener("pointerenter", enter);
        card.addEventListener("pointermove", move);
        card.addEventListener("pointerleave", leave);
        return () => {
          card.removeEventListener("pointerenter", enter);
          card.removeEventListener("pointermove", move);
          card.removeEventListener("pointerleave", leave);
          wave?.kill();
          gsap.killTweensOf([card, title, ...rings, ripple].filter(Boolean));
        };
      });
      cleanup = () => offs.forEach(off => off());
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
