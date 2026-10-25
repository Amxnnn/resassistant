import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, LayoutDashboard, PhoneForwarded, ShieldCheck, Utensils } from "lucide-react";
import { BRAND } from "./_brand/brand";
import { AssistantFace } from "./_brand/assistant-face";
import { HeroConversation } from "./_brand/hero-conversation";

export const metadata: Metadata = {
  title: `${BRAND.name} · ${BRAND.tagline}`,
  description:
    "An AI receptionist that answers your restaurant's phone, books and changes tables, answers menu questions from your own data, and hands off to staff whenever a guest asks."
};

const STEPS = [
  { title: "Picks up", body: "Answers with your restaurant's name, says it's an AI assistant, and offers a person at any time." },
  { title: "Listens", body: "Waits for the guest to finish, not just for silence, and stops talking the moment they cut in." },
  { title: "Checks", body: "Looks up real tables, hours and dishes through your API. It never makes up a time or an allergen." },
  { title: "Confirms", body: "Reads the booking back, waits for a yes, and gives the guest a short code to change it later." }
];

const HANDLES = [
  { icon: CalendarDays, title: "Bookings", body: "Book, change and cancel tables. When a time is full, it offers the three closest free times." },
  { icon: Utensils, title: "Menu questions", body: "Dishes, prices, vegetarian and vegan options, spice. Allergens come only from your menu data." },
  { icon: Clock, title: "Hours and info", body: "Opening hours, closed dates, location, parking, delivery apps and today's specials." },
  { icon: PhoneForwarded, title: "Handoff", body: "Transfers to staff on request, and takes a message for large parties, events and catering." },
  { icon: LayoutDashboard, title: "A staff dashboard", body: "Tonight's tables, every booking, the call log with transcripts, and editors for menu and hours." },
  { icon: ShieldCheck, title: "Rules in code", body: "A database rule stops double bookings, and callers can only touch their own bookings." }
];

export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Link href="/" className="lp-logo" aria-label={`${BRAND.name} home`}>
            <AssistantFace size={30} label={BRAND.name} />
            <span>{BRAND.name}</span>
          </Link>
          <nav className="lp-links" aria-label="Page">
            <a href="#how">How it works</a>
            <a href="#handles">What it handles</a>
          </nav>
          <div className="lp-nav-actions">
            <Link href="/login" className="btn btn-quiet lp-signin">
              Staff sign in
            </Link>
            <Link href="/demo" className="btn btn-primary">
              Try the demo
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <h1 className="lp-display">Every call answered. Every table booked right.</h1>
              <p className="lp-lede">
                {BRAND.name} picks up your restaurant's phone, books and changes tables, answers menu questions from your own data,
                and hands the call to your staff the moment a guest asks.
              </p>
              <div className="lp-ctas">
                <Link href="/demo" className="btn btn-primary lp-btn-lg">
                  Talk to it now <ArrowRight size={17} strokeWidth={2.4} />
                </Link>
                <Link href="/login" className="btn btn-secondary lp-btn-lg">
                  Open the dashboard
                </Link>
              </div>
              <p className="lp-fineprint">The demo restaurant, The Saffron Table, and every guest in it are made up.</p>
            </div>
            <HeroConversation />
          </div>
        </section>

        <section id="how" className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2">How a call goes</h2>
            <p className="lp-sub">Built for the way a host actually answers the phone, aiming to reply in under 800 ms.</p>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="lp-step">
                  <span className="lp-step-n num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="handles" className="lp-section lp-section-alt">
          <div className="lp-wrap lp-handles">
            <div>
              <h2 className="lp-h2">What it handles</h2>
              <p className="lp-sub">The calls that take a host away from the floor during service.</p>
            </div>
            <div className="group lp-list">
              {HANDLES.map(h => {
                const Icon = h.icon;
                return (
                  <div key={h.title} className="row row-has-lead lp-list-row">
                    <span className="row-lead">
                      <Icon size={19} />
                    </span>
                    <span className="row-main">
                      <span className="row-title" style={{ display: "block", whiteSpace: "normal" }}>
                        {h.title}
                      </span>
                      <span className="lp-list-body">{h.body}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap lp-close">
            <AssistantFace size={120} followPointer label={`${BRAND.name} receptionist`} />
            <h2 className="lp-h2">Hear it for yourself.</h2>
            <p className="lp-sub">Call the demo restaurant from your browser. Talk or type, and interrupt it whenever you like.</p>
            <div className="lp-ctas" style={{ justifyContent: "center" }}>
              <Link href="/demo" className="btn btn-primary lp-btn-lg">
                Start a demo call <ArrowRight size={17} strokeWidth={2.4} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <span>
            {BRAND.name} · {BRAND.tagline}
          </span>
          <span>
            <Link href="/demo">Demo</Link> · <Link href="/login">Staff sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
