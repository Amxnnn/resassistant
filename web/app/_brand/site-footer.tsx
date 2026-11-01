"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUp, ArrowUpRight } from "lucide-react";
import { BRAND } from "./brand";
import { FooterWordmark } from "./footer-wordmark";

/** Where an in-page link lands. "How a call goes" opens the pinned story at its first step. */
function targetY(hash: string) {
  if (hash === "#top") return 0;
  if (hash === "#how") {
    const story = document.querySelector<HTMLElement>(".story");
    if (story?.hasAttribute("data-scrolly")) return story.offsetTop + 0.16 * (story.offsetHeight - window.innerHeight);
  }
  const el = document.querySelector<HTMLElement>(hash);
  return el ? el.getBoundingClientRect().top + window.scrollY - 24 : null;
}

export function SiteFooter() {
  const ref = useRef<HTMLElement>(null);

  // In-page links glide there with GSAP instead of jumping.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let glide: ((y: number) => void) | null = null;
    if (!reduced) {
      Promise.all([import("gsap"), import("gsap/ScrollToPlugin")]).then(([{ gsap }, { ScrollToPlugin }]) => {
        gsap.registerPlugin(ScrollToPlugin);
        glide = y => gsap.to(window, { scrollTo: { y, autoKill: true }, duration: 1.4, ease: "power3.inOut" });
      });
    }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!a) return;
      const hash = a.getAttribute("href")!;
      const y = targetY(hash);
      if (y === null) return;
      e.preventDefault();
      if (glide) glide(y);
      else window.scrollTo(0, y);
      history.replaceState(null, "", hash === "#top" ? window.location.pathname : hash);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  return (
    <footer ref={ref} className="site-footer">
      <div className="wrap footer-top">
        <div className="footer-pitch">
          <p className="footer-lead">The phone rings mid-service. {BRAND.name} picks up.</p>
          <p className="footer-sub">
            It books real tables, answers from your own menu, and hands the call to your staff whenever a guest asks. Every
            call lands in your dashboard.
          </p>
          <div className="ctas footer-ctas">
            <Link href="/demo" className="pill pill-light">
              Try the demo call <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link href="/login" className="pill pill-dark">
              Staff sign in
            </Link>
          </div>
        </div>

        <nav className="footer-cols" aria-label="Footer">
          <div>
            <p className="footer-col-title">On this page</p>
            <ul>
              <li>
                <a href="#how">How a call goes</a>
              </li>
              <li>
                <a href="#outcomes">What a call ends in</a>
              </li>
              <li>
                <a href="#rules">The rules in code</a>
              </li>
              <li>
                <a href="#hear">Hear it</a>
              </li>
            </ul>
          </div>
          <div>
            <p className="footer-col-title">Try it</p>
            <ul>
              <li>
                <Link href="/demo">Demo call</Link>
              </li>
              <li>
                <Link href="/login">Staff dashboard</Link>
              </li>
            </ul>
          </div>
        </nav>
      </div>

      <FooterWordmark />

      <div className="wrap footer-bottom">
        <span>
          © 2026 {BRAND.name} · {BRAND.tagline}
        </span>
        <span>The Saffron Table, its menu and every guest on this site are made up.</span>
        <a href="#top" className="footer-up">
          Back to top <ArrowUp size={14} strokeWidth={2.2} aria-hidden="true" />
        </a>
      </div>
    </footer>
  );
}
