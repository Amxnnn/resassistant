---
version: 1
slug: "app-dashboard-page-tsx"
primary_target: "app/dashboard/page.tsx"
related_targets: ["app/_dashboard"]
---

## Scope

Staff dashboard, `web/app/dashboard/page.tsx` (one route, eight screens). Mode: Operate.

## Audience and job

Host or manager on a laptop before and during dinner service, sometimes on a phone. Job: see tonight at a glance, take or cancel a booking, answer messages the receptionist took, keep the menu, hours and spoken answers correct. Demo viewers reach calls, latency and the test call one tap down.

## Constraints

- Pinned by the user: minimal, professional, iOS and Notion inspired.
- 2026-10-28, user: when the public site moved to the dark rust-and-serif world, the dashboard kept this light layout. It takes the brand's rust-orange accent and the iPhone orb test call from the public site.
- Real data only. Empty is shown as empty; no fallback numbers.
- Times in the restaurant timezone (Asia/Kolkata). Plain CSS, lucide icons, no component library.
- Keep the per-language seam on info answers without featuring the second language.

## Direction contract

THESIS: The dashboard reads like the restaurant's own phone: tonight's guests, calls and messages laid out as Recents and Voicemail inside a quiet Notion workspace. It refuses the admin-template arrangement of KPI cards over a chart over a table.

OWN-WORLD: White page, near-white sidebar, inset grouped lists with 1px hairline separators, one system-grade sans with tabular figures, a single saffron tint reserved for now/next and the primary action. Status reads as small coloured dots and words, never filled badges. Detail opens in a sheet; filters are segmented controls; toggles are iOS switches.

STORY: The host opens it and knows, in one glance, how many guests are coming tonight, who is next, which tables are free when, and what needs them. They act from the same row, and trust that every number came from a real booking or call.

FIRST VIEWPORT: Left sidebar (restaurant, grouped navigation, restaurant-local clock). Large title "Tonight" with one summary line: bookings, covers, next arrival. Primary "New booking" at the title's right. Full-width tables-by-time strip with a saffron now-line and bookings drawn to their real seating length. Below, tonight's bookings as an inset list on the left, "Needs you" (new messages) on the right.

FORM: The Front-Desk Phone, candidate 5 of 7 on my ordered list (iOS Phone app grammar: Recents, Voicemail, detail sheets), seed key a89b27d6. Raises: duration drawn to scale (labanotation); accent only for now/next (terminal wayfinding); one face and hairlines only (design annual); tabular figures everywhere (datamatics); detail beside the list (streaming wall); per-turn latency right-aligned like track times (j-card).

Signature interaction: the detail sheet. Any booking, message or call row opens a sheet that slides in on the iOS sheet curve while the list stays in place; on a phone it rises from the bottom.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The test call is a scripted simulation; its timings are illustrative and labelled as such.
