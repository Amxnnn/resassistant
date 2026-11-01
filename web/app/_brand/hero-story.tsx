"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BRAND } from "./brand";
import { SampleCall } from "./sample-call";

const STEPS = [
  { title: "Picks up", body: "Answers with your restaurant’s name, says it’s an AI assistant, and offers a person at any time." },
  { title: "Listens", body: "Waits for the guest to finish, not just for silence, and stops talking the moment they cut in." },
  { title: "Checks", body: "Looks up real tables, hours and dishes through your API. It never makes up a time or an allergen." },
  { title: "Confirms", body: "Reads the booking back, waits for a yes, and gives the guest a short code to change it later." }
];

// Scroll progress where the story takes over from the hero, and how much each step gets.
const STORY_START = 0.12;
const STEP_SPAN = (1 - STORY_START) / STEPS.length;

/**
 * The hero and the story are one stage. On a wide screen the phone rises and pins while you scroll,
 * and the sample call plays one step at a time; elsewhere the call loops and the steps read as a list.
 */
export function HeroStory() {
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(-1);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    let revert = () => {};

    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1100px) and (min-height: 680px) and (prefers-reduced-motion: no-preference)", () => {
        el.dataset.scrolly = "";
        const stage = el.querySelector<HTMLElement>(".story-stage")!;
        const copy = el.querySelector<HTMLElement>(".hero-copy")!;
        const phone = el.querySelector<HTMLElement>(".story-phone")!;
        const steps = el.querySelector<HTMLElement>(".story-steps")!;
        // The phone centres in the space under the floating nav, not under the whole stage.
        const navH = () => parseFloat(getComputedStyle(el).getPropertyValue("--nav-h")) || 72;

        gsap
          .timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: el,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.7,
              invalidateOnRefresh: true,
              onUpdate: self => {
                const p = self.progress;
                const next = p < STORY_START ? -1 : Math.min(STEPS.length - 1, Math.floor((p - STORY_START) / STEP_SPAN));
                setStep(s => (s === next ? s : next));
              }
            }
          })
          .to(copy, { y: () => -copy.offsetHeight * 0.35, autoAlpha: 0, duration: 0.09 }, 0)
          .to(
            phone,
            {
              x: () => -stage.clientWidth * 0.21,
              y: () => navH() + (stage.clientHeight - navH() - phone.offsetHeight) / 2 - phone.offsetTop,
              duration: STORY_START + 0.01,
              ease: "power2.inOut"
            },
            0
          )
          .fromTo(steps, { autoAlpha: 0, x: 40 }, { autoAlpha: 1, x: 0, duration: 0.05 }, 0.09)
          .to({}, { duration: 1 - STORY_START }, STORY_START);

        return () => {
          delete el.dataset.scrolly;
          setStep(-1);
        };
      });
      revert = () => mm.revert();
    })();

    return () => {
      cancelled = true;
      revert();
    };
  }, []);

  return (
    <section ref={root} className="story">
      <div className="story-stage">
        <div className="hero-copy">
          <h1 className="display-1 hero-title">
            <span className="line">Every call answered.</span> <span className="line">Every table booked right.</span>
          </h1>
          <p className="lede hero-lede">
            {BRAND.name} picks up your restaurant’s phone, books and changes tables, answers menu questions from your own data,
            and hands the call to your staff the moment a guest asks.
          </p>
          <div className="ctas hero-ctas">
            <Link href="/demo" className="pill pill-light">
              Talk to it now <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link href="/login" className="pill pill-dark">
              Open the dashboard
            </Link>
          </div>
        </div>

        <figure className="story-phone">
          <div className="story-device" aria-hidden="true">
            <SampleCall step={step} />
          </div>
        </figure>

        <div id="how" className="story-steps">
          <h2 className="display-2 story-heading">How a call goes</h2>
          <ol className="story-rail" aria-hidden="true">
            {STEPS.map((s, i) => (
              <li key={s.title} data-active={step === i || undefined} data-past={step > i || undefined}>
                {s.title}
              </li>
            ))}
          </ol>
          <ol className="story-list">
            {STEPS.map((s, i) => (
              <li key={s.title} className="story-step" data-active={step === i || undefined}>
                <h3 className="story-title">{s.title}.</h3>
                <p className="story-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
