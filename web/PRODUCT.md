# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the host or manager of the restaurant, on a laptop before and during service, sometimes on a phone. They check tonight's bookings, take a booking by hand, answer messages the AI took for the manager, and keep the menu, hours and info answers correct.

Secondary: people watching a demo of the project (portfolio reviewers). They need to reach the live test call, call transcripts and per-turn latency within one tap, but these never lead the home screen.

## Product Purpose

The staff side of an AI phone receptionist. The voice agent answers calls, books tables and answers questions. This dashboard is where staff see what it booked, control what it is allowed to say, and review what it said. Success means a host can see tonight at a glance and trust that every booking, dish and answer on screen is real.

## Positioning

Staff own the AI's facts. Allergens come only from the menu data, info answers are spoken as written, and every call can be audited turn by turn with its latency. The dashboard is the control surface for that promise, not a generic booking tool.

## Operating Context

- One restaurant per deployment for now: The Saffron Table, a fake demo restaurant in Bengaluru (timezone Asia/Kolkata, prices in INR, dialed number +1 415 555 0123).
- Busy dinner service: the user glances between guests, so tonight's state must read in seconds.
- Times are shown in the restaurant's timezone. The API owns all date maths.
- Info answers have per-language versions (English, Hindi). The second language is not final, so keep the per-language seam without featuring Hindi everywhere.

## Capabilities and Constraints

- Screens: Today (tonight's bookings and tables), Reservations (search, filter, add, cancel), Menu (dishes, dietary tags, spice, allergens, available today), Hours and info (weekly hours, closures, info answers per language), Calls (transcripts, per-turn latency), Messages (manager inbox with status), Test call (browser call), Analytics (booking rate, transfer rate, latency).
- Rule: a dish cannot be marked available today until its allergens are confirmed. The API enforces it too.
- Rule: parties above the phone party limit (8) go to the manager as a message.
- The browser test call is currently a scripted simulation that calls the real agent API endpoints; it is not yet a LiveKit audio call.
- Stack: Next.js 15 (App Router), React 19, plain CSS in `app/globals.css`, lucide-react icons. No Tailwind or component library.
- Free tiers only; fake restaurants and callers only.

## Brand Commitments

- Restaurant name: The Saffron Table (fake).
- The user pinned the look for the dashboard: minimal, professional, iOS and Notion inspired.

## Evidence on Hand

- `db/seed-data.json`: one restaurant, 6 tables, 20 dishes, 7 opening-hours rows, 1 closure, 12 info entries, 2 reservations, 2 messages, 1 call with turns.
- No real customers, usage figures or benchmarks. Metrics on screen must come from the API; when there is no data, say so instead of showing a made-up number.

## Product Principles

1. Tonight first. The home screen answers "who is coming, where are they sitting, what needs me" before anything else.
2. Nothing on screen is invented. Empty is shown as empty.
3. Safety rules are visible where staff act: allergens on the dish, the party limit on the booking form.
4. Telemetry is for audit and demo, so it sits one level down, never in the way of service.
5. Calm under pressure: few colors, clear states, no decoration competing with the data.

## Accessibility & Inclusion

No product-specific requirement was established beyond WCAG AA contrast, keyboard access, and touch targets usable on a phone.
