---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/demo/page.tsx","app/login/page.tsx","app/_brand"]
---

## Scope

Public site: the landing page `web/app/page.tsx`, with the live demo call (`app/demo/page.tsx`) and staff sign-in (`app/login/page.tsx`) in the same world. Mode: Persuade.

## Audience and job

Restaurant owners and managers deciding whether an AI should answer their phone, and portfolio reviewers watching the project. In one viewport they must see that this answers a restaurant's calls and books real tables; then believe it only says what the restaurant's own data says; then act: call the demo from the browser.

## Constraints

- Pinned by the user (2026-10-28), from the Nisa reference: black ground, warm rust and orange glow, condensed high-contrast serif display, tight neo-grotesk body, pill buttons, rounded gradient cards. Minimal, clean, premium.
- Pinned: the assistant is a futuristic 3D particle orb (reference: a dotted sphere shading cool at the crown to warm at the base) inside a clean iOS iPhone mockup. Three.js, GSAP where it helps. The orb moves as it speaks.
- On phones the live demo drops the iPhone frame and the call fills the screen; tablet and desktop show the frame.
- The staff dashboard keeps its light layout (its own brief); it shares the accent and the iPhone test call.
- No invented customers, logos, metrics or prices. The Saffron Table and its guests are fake and labelled so; facts shown come from `db/seed-data.json`.

## Direction contract

THESIS: Every call ends in something the restaurant can keep: a booking with a code, an answer from its own menu, a message for the manager. The page follows one call to that card. It refuses the AI-agent template of a floating orb over a use-case grid and a logo wall.

OWN-WORLD: Black ground under a rust evening glow. Instrument Serif display over Inter Tight. White and black pills with an arrow. Outcome cards in rust-to-black gradients, one paper card, one dark card. A particle orb lit by dot density alone, cool crown to warm base, living inside a clean iPhone. Fixed-width figures; one loud serif line per section.

STORY: An owner watches the phone take a call while the booking card assembles fact by fact, sees what else a call can end in, sees the dense band of facts it is allowed to say, and calls it from the browser.

FIRST VIEWPORT: Floating nav: orb mark and Hostline left; Staff sign in and a white "Try the demo" pill right. Centred two-line serif headline at about 6vw, lede, white "Talk to it now" and dark "Open the dashboard" pills. The iPhone rises from the bottom edge, centred, mid-call: The Saffron Table, timer, orb speaking, captions; the booking card assembles just below the fold.

FORM: The Confirmation Card, candidate 7 of 7 on my ordered list, seed key 17893ed2. Raises: each confirmed fact stays (Coiled Earth Tower); one call followed end to end (Rain-Night Cityscape); orb lit by density alone (ASCII Live Render); fixed-width figures that cross-fade (Nixie Laboratory Counter); one loud fragment per section (Raygun Layout Desk); a bare orb against one dense band of real facts (Shibuya Boutique Sleeve).

Signature interaction: on desktop the phone rises and pins as you scroll, the call advances step by step (picks up, listens, checks, confirms) and the booking card assembles fact by fact. The orb follows the voice: the live audio level on the demo, a speech envelope on the landing.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The live demo needs the agent worker running; the landing page's call is a scripted sample and is labelled as one.
