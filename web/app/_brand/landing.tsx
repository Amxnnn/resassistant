import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import seed from "@/db/seed-data.json";
import { BRAND } from "./brand";
import { Mark } from "./site-nav";
import { RaceFigure } from "./race";
import { WakeOrb } from "./wake-orb";

const OUTCOMES = [
  {
    id: "booked",
    title: "Table for 4, tonight at 8:30.",
    body: "Confirmed with code K7Q2. The guest can change or cancel it later with the code."
  },
  {
    id: "answered",
    title: "“The paneer tikka lists dairy. Nuts aren’t listed.”",
    body: "Answered from your menu data. A missing allergen is said as not listed, never guessed."
  },
  {
    id: "handoff",
    title: "“Putting you through to the host.”",
    body: "Transferred whenever a guest asks for a person."
  },
  {
    id: "message",
    title: "Party of 14 on Friday, in the private room.",
    body: "Taken as a message for the manager: it’s over your phone limit of 8."
  }
];

export function Outcomes() {
  return (
    <section className="outcomes" aria-labelledby="outcomes-title">
      <div className="wrap outcomes-grid">
        <h2 id="outcomes-title" className="display-2 outcomes-statement">
          Every call ends in something you can keep.
        </h2>
        {OUTCOMES.map(o => (
          <article key={o.id} className={`outcome is-${o.id}`}>
            <div className="outcome-text">
              {o.id === "handoff" ? (
                <div className="outcome-halo">
                  <span className="outcome-rings" aria-hidden="true">
                    <i />
                    <i />
                  </span>
                  <h3 className="outcome-title">{o.title}</h3>
                </div>
              ) : (
                <h3 className="outcome-title">{o.title}</h3>
              )}
              <p className="outcome-body">{o.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const RULES = [
  {
    title: "No double bookings.",
    body: "A database rule rejects overlapping bookings for a table, even when two calls race for the same time."
  },
  {
    title: "Only the caller’s own booking.",
    body: "A caller can change or cancel only bookings tied to their number or code. The server checks, not the AI."
  },
  {
    title: "Dates worked out by the API.",
    body: "The AI passes days as the guest said them, and the API turns “this Tuesday” into the right date."
  }
];

export function Rules() {
  return (
    <section className="rules" aria-labelledby="rules-title">
      <div className="wrap rules-grid">
        <RaceFigure />
        <div className="rules-copy">
          <h2 id="rules-title" className="display-2">
            The rules live in code, not in the prompt.
          </h2>
          <dl className="rules-list">
            {RULES.map(r => (
              <div key={r.title}>
                <dt>{r.title}</dt>
                <dd>{r.body}</dd>
              </div>
            ))}
          </dl>
          <p className="rules-dash">
            Every booking and call lands in the staff dashboard, with each turn’s transcript and how fast it replied.
          </p>
          <Link href="/login" className="pill pill-dark">
            Open the dashboard <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* The facts band: what the receptionist may say about the demo restaurant, straight from its seed data. */

function dishFact(d: (typeof seed.menu)[number]) {
  const allergens = !d.allergensListed
    ? "allergens not listed"
    : d.allergens.length
      ? d.allergens.join(", ")
      : "no listed allergens";
  const extra = [d.dietaryTags.includes("vegan") ? "vegan" : null, d.spiceLevel === "hot" ? "hot" : null].filter(Boolean);
  return [d.name, `₹${d.price}`, allergens, ...extra].join(" · ");
}

function infoFacts() {
  const r = seed.restaurant;
  const en = (topic: string) => seed.info_entries.find(i => i.topic === topic && i.language === "en")?.answer;
  return [r.hoursSummary, r.address, en("parking"), en("delivery"), en("specials"), ...r.policies].filter(
    (f): f is string => Boolean(f)
  );
}

function BandRow({ facts, reverse, seconds }: { facts: string[]; reverse?: boolean; seconds: number }) {
  const items = (hidden?: boolean) => (
    <ul className="band-track" aria-hidden={hidden || undefined}>
      {facts.map(f => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
  return (
    <div className={`band-row${reverse ? " is-reverse" : ""}`} style={{ "--band-s": `${seconds}s` } as React.CSSProperties}>
      <div className="band-move">
        {items()}
        {items(true)}
      </div>
    </div>
  );
}

export function Close() {
  return (
    <section className="close" aria-labelledby="close-title">
      <WakeOrb>
        <h2 id="close-title" className="display-1 close-title">
          Hear it for yourself.
        </h2>
        <p className="lede close-lede">
          Call {seed.restaurant.name} from your browser. Talk or type, cut in whenever you like, and ask about anything on the
          band below.
        </p>
        <div className="ctas">
          <Link href="/demo" className="pill pill-light" data-wake>
            Start a demo call <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </div>
      </WakeOrb>

      <div className="band" role="region" aria-label={`What the receptionist knows about ${seed.restaurant.name}`}>
        <p className="wrap band-label">Everything it knows about {seed.restaurant.name}, and nothing else.</p>
        <BandRow facts={seed.menu.map(dishFact)} seconds={110} />
        <BandRow facts={infoFacts()} seconds={140} reverse />
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer-inner">
        <span className="site-footer-brand">
          <Mark size={18} />
          {BRAND.name}
          <span className="site-footer-tag">{BRAND.tagline}</span>
        </span>
        <nav aria-label="Footer" className="site-footer-links">
          <Link href="/demo">Demo call</Link>
          <Link href="/login">Staff sign in</Link>
        </nav>
      </div>
      <p className="wrap site-footer-note">The Saffron Table, its menu and every guest on this site are made up.</p>
    </footer>
  );
}
