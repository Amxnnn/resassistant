"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { Tab } from "./types";

type Gsap = typeof import("gsap").gsap;

// Rows that do something when clicked; the lens only visits these.
const ROW = ".group > button.row, .group > a.row, .group > .row:has(> .row-link)";

/**
 * The dashboard's motion layer (GSAP). A lens glides between rows and between nav items, the nav
 * selection slides to the open screen, the primary button leans toward the pointer and springs back,
 * and each screen rises in a short stagger when it opens. Reduced motion turns it all off; the
 * pointer effects only run with a mouse or trackpad.
 */
export function useDashboardMotion(root: RefObject<HTMLElement | null>, tab: Tab) {
  const gsapRef = useRef<Gsap | null>(null);
  const firstScreen = useRef(true);

  const placeSelection = (animate: boolean) => {
    const gsap = gsapRef.current;
    const nav = root.current?.querySelector<HTMLElement>(".sidebar nav");
    const selection = nav?.querySelector<HTMLElement>(".nav-selection");
    if (!gsap || !nav || !selection) return;
    const active = nav.querySelector<HTMLElement>('.nav-item[aria-current="page"]');
    if (!active) {
      gsap.to(selection, { opacity: 0, duration: 0.2 });
      return;
    }
    const to = { y: active.offsetTop, height: active.offsetHeight, opacity: 1 };
    if (animate) gsap.to(selection, { ...to, duration: 0.55, ease: "power3.inOut", overwrite: true });
    else gsap.set(selection, to);
  };

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let cancelled = false;
    let off = () => {};

    import("gsap").then(({ gsap }) => {
      if (cancelled) return;
      gsapRef.current = gsap;
      el.classList.add("has-motion");
      placeSelection(false);
      if (!pointer) return;

      // One lens per list (or per sidebar), moved to whatever is under the pointer.
      const lensIn = (container: HTMLElement, cls: string) => {
        let lens = container.querySelector<HTMLElement>(`:scope > .${cls}`);
        if (!lens) {
          lens = document.createElement("span");
          lens.className = cls;
          lens.setAttribute("aria-hidden", "true");
          container.prepend(lens);
        }
        return lens;
      };
      const glide = (lens: HTMLElement, target: HTMLElement) => {
        const shown = Number(gsap.getProperty(lens, "opacity")) > 0.05;
        const to = { y: target.offsetTop, height: target.offsetHeight };
        if (shown) gsap.to(lens, { ...to, opacity: 1, duration: 0.38, ease: "power3.out", overwrite: true });
        else {
          gsap.set(lens, to);
          gsap.to(lens, { opacity: 1, duration: 0.2, overwrite: true });
        }
      };
      const fade = (lens: Element | null) => lens && gsap.to(lens, { opacity: 0, duration: 0.25, overwrite: true });

      const onOver = (e: PointerEvent) => {
        const t = e.target as Element;
        const item = t.closest<HTMLElement>(".sidebar .nav-item");
        if (item) {
          const nav = item.closest<HTMLElement>("nav")!;
          glide(lensIn(nav, "nav-lens"), item);
          return;
        }
        const row = t.closest<HTMLElement>(ROW);
        if (row) glide(lensIn(row.parentElement!, "row-lens"), row);
      };
      const onOut = (e: PointerEvent) => {
        const t = e.target as Element;
        const next = e.relatedTarget as Element | null;
        const nav = t.closest(".sidebar nav");
        if (nav && !next?.closest(".sidebar .nav-item")) fade(nav.querySelector(":scope > .nav-lens"));
        const group = t.closest(".group");
        if (group && !(next && group.contains(next) && next.closest(ROW))) fade(group.querySelector(":scope > .row-lens"));
      };

      // The primary button leans toward the pointer and springs back when it leaves.
      let magnet: HTMLElement | null = null;
      let leanX: ((v: number) => void) | null = null;
      let leanY: ((v: number) => void) | null = null;
      const release = (btn: HTMLElement) =>
        gsap.to(btn, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
      const onMove = (e: PointerEvent) => {
        const btn = (e.target as Element).closest<HTMLElement>(".btn-primary:not(:disabled)");
        if (btn !== magnet) {
          if (magnet) release(magnet);
          magnet = btn;
          leanX = btn ? gsap.quickTo(btn, "x", { duration: 0.4, ease: "power3.out" }) : null;
          leanY = btn ? gsap.quickTo(btn, "y", { duration: 0.4, ease: "power3.out" }) : null;
        }
        if (!btn || !leanX || !leanY) return;
        const r = btn.getBoundingClientRect();
        leanX((e.clientX - (r.left + r.width / 2)) * 0.16);
        leanY((e.clientY - (r.top + r.height / 2)) * 0.26);
      };
      const onDown = (e: PointerEvent) => {
        const btn = (e.target as Element).closest<HTMLElement>(".btn-primary:not(:disabled)");
        if (btn) gsap.to(btn, { scale: 0.95, duration: 0.1, ease: "power2.out" });
      };
      const onUp = () => {
        if (magnet) gsap.to(magnet, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.45)" });
      };
      const onLeaveApp = () => {
        if (magnet) release(magnet);
        magnet = null;
      };

      el.addEventListener("pointerover", onOver);
      el.addEventListener("pointerout", onOut);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointerleave", onLeaveApp);
      off = () => {
        el.removeEventListener("pointerover", onOver);
        el.removeEventListener("pointerout", onOut);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointerleave", onLeaveApp);
      };
    });

    return () => {
      cancelled = true;
      off();
      el.classList.remove("has-motion");
      gsapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // A new screen: the selection slides to it and the screen rises in, piece by piece.
  useLayoutEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    const gsap = gsapRef.current;
    if (!gsap) return;
    placeSelection(true);
    const page = root.current?.querySelector(".main main > .page");
    if (!page) return;
    gsap.fromTo(
      page.children,
      { y: 14, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.05, ease: "power3.out", clearProps: "transform,opacity,visibility" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
}
