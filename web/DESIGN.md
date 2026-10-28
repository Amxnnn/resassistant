---
name: Hostline
description: The AI receptionist for restaurants. A black stage lit by a rust evening glow, where one call ends in something the restaurant can keep.
colors:
  rust-500: "#b4491a"
  card-rust: "#a8441a"
  rust-deep: "#6e2a10"
  rust-char: "#2a120a"
  glow-ember: "#8f3a16"
  ember-orange: "#e4682c"
  band-orange: "#dc6224"
  peach: "#f4c3a0"
  confirm-green: "#7ee2a0"
  call-green: "#34c759"
  call-red: "#ff3b30"
  orb-amber: "#ffb573"
  orb-ember: "#f25e29"
  orb-rose: "#bd3870"
  orb-iris: "#616ef5"
  ground: "#000000"
  ink: "#f3efe9"
  ink-2: "rgba(243, 239, 233, 0.74)"
  ink-3: "rgba(243, 239, 233, 0.58)"
  hair: "rgba(243, 239, 233, 0.13)"
  veil: "rgba(243, 239, 233, 0.06)"
  pill-black: "#0d0a09"
  pill-black-hover: "#1a1310"
  slab-dark: "#121010"
  paper: "#ebe7e1"
  on-paper: "#0c0807"
  on-paper-2: "#3d3631"
  on-rust: "#f8e2d6"
  on-band: "#140905"
typography:
  display:
    fontFamily: "Instrument Serif, Iowan Old Style, Times New Roman, serif"
    fontSize: "clamp(3rem, 6.2vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.96
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Instrument Serif, Iowan Old Style, Times New Roman, serif"
    fontSize: "clamp(2.4rem, 4.3vw, 4.25rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Instrument Serif, Iowan Old Style, Times New Roman, serif"
    fontSize: "clamp(1.9rem, 2.5vw, 2.5rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Inter Tight, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.0625rem, 1.25vw, 1.1875rem)"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Inter Tight, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.012em"
  label:
    fontFamily: "Inter Tight, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.01em"
  fineprint:
    fontFamily: "Inter Tight, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.012em"
  figures:
    fontFamily: "Inter Tight, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontWeight: 600
    fontFeature: "tnum"
rounded:
  code: "6px"
  focus: "8px"
  bar: "10px"
  track: "12px"
  field: "16px"
  slab-sm: "24px"
  slab: "30px"
  figure: "32px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 4vw, 56px)"
  wrap: "1240px"
  nav-h: "72px"
  nav-h-compact: "64px"
  cta-gap: "12px"
  grid-gap: "20px"
  slab-pad: "clamp(24px, 2.4vw, 34px)"
  section: "clamp(96px, 12vw, 168px)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.pill-black}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "46px"
  button-secondary-hover:
    backgroundColor: "{colors.pill-black-hover}"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "38px"
  chip-ask:
    backgroundColor: "{colors.veil}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  input-field:
    backgroundColor: "{colors.veil}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 18px"
    height: "52px"
  card-paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.on-paper}"
    rounded: "{rounded.slab}"
    padding: "{spacing.slab-pad}"
  card-dark:
    backgroundColor: "{colors.slab-dark}"
    textColor: "{colors.ink}"
    rounded: "{rounded.slab}"
    padding: "{spacing.slab-pad}"
  facts-band:
    backgroundColor: "{colors.band-orange}"
    textColor: "{colors.on-band}"
    height: "46px"
    padding: "0 22px"
---

# Design System: Hostline

## Overview

**Creative North Star: "The Confirmation Card"**

Hostline's public world is a black stage under a rust evening glow. Everything on it follows one phone call to the thing it leaves behind: a booking with a code, an answer read from the restaurant's own menu, a hand-off, a message for the manager. Light comes from above and from the corners, never from flat colored panels; the page is almost entirely black, ink and rust light, with one paper card as the single bright surface.

Type carries the voice. A condensed high-contrast serif (Instrument Serif) speaks one loud line per section; a tight neo-grotesk (Inter Tight) does all the explaining, in muted warm ink. Actions are pills: white for the thing to do, black for the alternative. The assistant itself is a particle orb lit only by the density of its dots, cool at the crown and warm at the base, and it lives inside a drawn iPhone where the call actually happens. Motion is slow, eased and blur-softened: facts arrive and then stay.

This is the project's primary design system and covers the landing page, the live demo call and staff sign-in. The staff dashboard is a separate Operate surface with its own light iOS/Notion system (everything in `app/globals.css` above the orb section). The two worlds share only the rust-orange tint, the iPhone/orb call screen (the dashboard's test call renders the same component), the Hostline name and app icon. Do not import this world's black ground, serif or pills into the dashboard, or the dashboard's grouped lists and hairline tables into this one.

**Key Characteristics:**
- Pure black ground; rust arrives as radial light and corner-lit gradients that fade to black.
- Instrument Serif display over Inter Tight body; only the drawn iPhone speaks in the iOS system face.
- Pills only for actions: white primary, black secondary, an up-right arrow on the way out.
- Large rounded slabs (30px) for outcomes: rust gradient, paper, dark.
- A Three.js particle orb inside a clean iPhone as the product's face.
- Fixed-width figures for every time, code and clock.

## Colors

A near-monochrome black-and-warm-ink palette with one hue family, rust to peach, used as light.

### Primary
- **Saddle Rust** (rust-500): the brand tint. Lights the booking pass gradient and the warm halo behind every phone (`rgba(180, 73, 26, 0.36)`). It is the same value as the dashboard's light-mode `--tint`, which makes it the hinge between the two worlds.
- **Card Rust** (card-rust): the bright corner of the outcome slabs and the race figure's glow; the gradient runs card-rust, rust-deep, rust-char to near-black `#120806`.
- **Rust Deep** and **Rust Char** (rust-deep, rust-char): the middle and dark stops of every rust gradient.
- **Ember Glow** (glow-ember): the stage light. Radial from the top on the hero (0.62 alpha) and sign-in (0.5), and from below centre at the close (0.42).

### Secondary
- **Ember Orange** (ember-orange): text selection (`0.45` alpha), the caret, the call composer's send button, the losing bar's outline in the race figure, and code-chip tint (`0.16` alpha). The orb's ember stop sits beside it.
- **Band Orange** (band-orange): the one flat fill on the page, the facts band, with near-black ink (on-band).

### Tertiary
- **Peach** (peach): the focus ring everywhere on the site and in the phone, the focused field's 1.5px inset ring, the winning bar, code-chip text, the pass's pending dot.
- **Confirm Green** (confirm-green): the pass's dot once the booking has a code, with a 3pt halo at 0.2 alpha. Nowhere else.
- **Call Green / Call Red** (call-green, call-red): iOS call keys only (start, end, mic-level ring at 0.32 alpha, error alert at 0.2 alpha).

### Orb palette
- **Amber, Ember, Rose, Iris** (orb-amber, orb-ember, orb-rose, orb-iris): the shader's height ramp from base to crown, plus a near-white flare `#fff5eb` on a few particles. The app icon draws the same ramp as `#ffb06e`, `#e4682c`, `#b8386f`, `#5b6cf0`.

### Neutral
- **Ground** (ground): every public page, `html` and `body`, with `color-scheme: dark` and a `#3a2a22` scrollbar thumb.
- **Warm Ink** (ink): headlines, primary text, the white pill's fill.
- **Ink 2 / Ink 3** (ink-2, ink-3): ledes, body copy and nav links; captions, fineprint, axis labels.
- **Hair** (hair): every edge. Inset rings, the race track's quarter lines, the step rail, the rules divider.
- **Veil** (veil): the fill of asks and fields on black.
- **Pill Black / Slab Dark** (pill-black, slab-dark): the secondary pill and the hand-off slab; the race figure uses `#0e0b0a` under its glow.
- **Paper** (paper): the single light slab, with on-paper and on-paper-2 ink.
- **On Rust** (on-rust): body text inside rust slabs; pass labels use `rgba(255, 238, 228, 0.66–0.8)`.

### Named Rules
**The Light Source Rule.** Rust is light, not paint. It arrives as radial glows and corner-lit gradients that fall to black. The only flat orange fills are the facts band and the composer's send button.

**The One Paper Rule.** A screen has at most one light surface (the paper slab). Everything else is black, near-black or rust-lit.

## Typography

**Display Font:** Instrument Serif 400 (with Iowan Old Style, Times New Roman)
**Body Font:** Inter Tight (with -apple-system, Helvetica Neue, Arial)
**Label Font:** Inter Tight. Inside the drawn iPhone, status bar and captions use the iOS system stack (-apple-system, SF Pro Text) because the device is iOS; that face stays inside the device.

**Character:** A tall, condensed serif with an evening-menu feel, set tight and large, over a compact grotesk tracked slightly negative (-0.012em) so the body reads quiet and close.

Both faces load through `next/font` as `--font-serif` and `--font-sans` and are applied only inside `.site` (and the dashboard's test call, which reuses the call screen).

### Hierarchy
- **Display** (400, clamp(3rem, 6.2vw, 6rem), 0.96; hero 0.94): one per page: hero, close, demo (clamp(3rem, 5.4vw, 5.25rem)), sign-in (clamp(2.5rem, 5vw, 3.25rem)). Balanced wrap.
- **Headline** (400, clamp(2.4rem, 4.3vw, 4.25rem), 1): section statements (outcomes at clamp(2.4rem, 3.7vw, 3.9rem), rules). Desktop story steps rise to clamp(3.5rem, 5.4vw, 5.5rem).
- **Title** (400, clamp(1.9rem, 2.5vw, 2.5rem), 1.02): outcome slabs, story steps (clamp(2rem, 3vw, 2.75rem)), rule terms (clamp(1.6rem, 2vw, 2rem)), the race's spoken line, the call's restaurant name (34pt) and the pass title (28pt).
- **Lede** (400, clamp(1.0625rem, 1.25vw, 1.1875rem), 1.5): under display lines, max 36em (hero 40em), ink-2, pretty wrap.
- **Body** (400, 16px, 1.5): explanations at ink-2, max 30 to 34em.
- **Label** (500, 13px, 0.01em, uppercase): pills only (12px on the small pill). Other small text (13 to 14px) stays sentence case.
- **Fineprint** (400, 0.8125rem, 1.55): disclaimers at ink-3, max 52ch.

### Named Rules
**The One Loud Line Rule.** Each section gets one serif display or headline line. Serif titles beneath it are subordinate and never compete in size.

**The Fixed Figures Rule.** Clocks, times, party sizes and codes use tabular figures so digits never shift as they change; codes add 0.08em tracking.

## Layout

A centred, single-column stage with a 1240px wrap and a fluid gutter (clamp(16px, 4vw, 56px)). The nav floats over the page at 72px (64px at 960px and below) on a black-to-transparent fade, with no bar. Sections breathe on clamp(96px, 12vw, 168px) vertical padding; pill rows gap at 12px and wrap centred.

- **Hero and story:** headline, lede and pills centred; the iPhone rises from the bottom edge beneath them in its own warm halo. At 1100px wide and 680px tall or more (with motion allowed), the stage pins for 480vh: the copy lifts away, the phone slides 21% left and centres vertically, and four steps play one at a time at the right (from 52% across, max 560px) under a four-segment progress rail. Below that, the call loops and the steps read as a two-column list (one column at 640px and below).
- **Outcomes:** a three-column grid (gap 20px, rows min 340px) with the headline in the centre column spanning both rows and four slabs around it. At 960px and below it becomes two columns with the headline on top; at 640px and below, one column.
- **Rules:** race figure and copy side by side (1.05fr / 1fr); at 1099px and below, one column with the copy first.
- **Close:** a 520px orb (88vw max) overlapping its headline by 16%, then the full-bleed facts band.
- **Demo:** copy left, phone right; at 860px and below, phone over copy; at 640px and below, the phone drops its frame and the call fills the screen (`100svh` minus the nav, min 540px), with the copy below.
- **Sign-in:** one centred 440px column under a 210px orb.
- **Phone sizing:** the device is drawn in points of a 393 x 852 screen (`1pt = 100cqw / 417`); landing width min(360px, 80vw), widening to 380px on desktop but capped by viewport height.

## Elevation & Depth

Flat surfaces with light instead of shadow. Depth comes from radial glow behind objects, gradient slabs and 1px inset rings. The only real drop shadow belongs to the iPhone, which is a physical object on the stage.

### Shadow Vocabulary
- **Device** (`0 44pt 80pt -12pt rgba(0,0,0,0.75), 0 8pt 20pt rgba(0,0,0,0.45), inset 0 0 0 0.8pt rgba(255,255,255,0.18)`): the iPhone body only.
- **Hair ring** (`inset 0 0 0 1px var(--hair)`): dark slab, race figure, asks, fields.
- **Pill ring** (`inset 0 0 0 1px rgba(243,239,233,0.2)`, 0.34 on hover): the black pill.
- **Glass ring** (`inset 0 0 0 1px rgba(255,255,255,0.1)`): the booking pass and composer inside the phone.
- **Phone halo** (`radial-gradient(closest-side, rgba(180,73,26,0.36), rgba(110,42,16,0.14) 55%, transparent)` at 200% of the phone): behind every framed phone.

### Named Rules
**The Inset Ring Rule.** Edges are 1px inset rings in hair or white at low alpha, never outer borders or drop shadows. A new surface that needs a drop shadow is either the phone or wrong.

## Shapes

Two shapes do almost everything: the full pill (999px) for every action, ask, chip and in-phone control, and the large soft slab (30px, 24px at 640px and below; 32px for the race figure) for content cards. Fields round at 16px, race tracks at 12px and bars at 10px, code chips at 6px. Focus outlines round at 8px except on pills, where they follow the pill. Inside the phone, radii scale in points (pass 22pt, caller bubble 18pt, alert 16pt, screen 65pt, body 68pt) and the in-call keys are circles. The only drawn ornament is the hand-off slab's pair of hairline ellipses, tilted -4 and 3 degrees.

## Components

### Buttons
Quiet, confident pills that point outward.
- **Shape:** full pill (999px), 46px tall; small 38px; 52px in the sign-in form.
- **Primary:** warm-ink pill with near-black uppercase label, brightening to pure white on hover. The one action per group.
- **Secondary:** black pill with a hair ring that strengthens on hover; the alternative action.
- **Arrow:** a 15 to 16px lucide up-right arrow on outbound links slides 2px up-right on hover (300ms, ease).
- **States:** colour and ring transitions 200ms; press scales to 0.98; disabled primary goes to 0.14 ink veil with 0.56 ink text; focus is a 2px peach outline offset 3px.

### Chips (asks)
- **Style:** veil fill, hair ring, 14px sentence-case text, min 38px tall, wrap freely.
- **State:** hover lifts to 0.12 fill and 0.26 ring; disabled at half opacity. They send a suggested question into the demo call.

### Cards / Containers (outcome slabs)
- **Corner Style:** 30px (24px on phones).
- **Background:** rust gradient lit from a bottom corner (booked from the left, message from the right), one paper slab (answered), one dark slab with a hair ring (hand-off).
- **Shadow Strategy:** none; light is in the fill.
- **Content:** serif title over Inter Tight body, bottom-aligned; the hand-off slab centres its line inside two hairline rings.
- **Internal Padding:** clamp(24px, 2.4vw, 34px).

### Inputs / Fields
- **Style:** 52px tall, 16px radius, veil fill, hair ring, 16px text, ink-3 placeholder; labels 13px ink-2 above.
- **Focus:** fill to 0.08 and a 1.5px peach inset ring.
- **Inline action:** a "Show" peek button sits inside the field's right edge (36px, 10px radius).

### Navigation
Floating, barless: orb mark and "Hostline" (17px, 600) left; "Staff sign in" (14px ink-2, ink on hover) and a small white "Try the demo" pill right. At 640px and below the text link hides and only the pill remains. Each page drops the link to itself.

### The Orb (signature)
A Three.js point sphere of bricked latitude rows (about 3.5px between dots at any size) with additive blending, coloured by height from amber at the base through ember and rose to iris at the crown, lit only by dot density. Four states (idle, listening, thinking, speaking) tween with GSAP (power3.out, 0.7s; 0.9s into thinking). Thinking twists bands around the axis; speaking runs a ripple up from the base, driven by the live voice level on the demo and a syllable envelope on the landing; a few warm-base particles lift off the rim. It draws only on screen and in a visible tab, follows a fine pointer, and slows to 15% with reduced motion. Before WebGL is ready (or without it), a rendered poster frame (`_brand/orb-poster.webp`) shows with screen blending, and the canvas fades in over 900ms. On the close, the orb leans in to listen while its call pill is hovered or focused.

### The iPhone call screen (signature)
A clean drawn iPhone (titanium gradient band, side keys, Dynamic Island, status bar, home indicator) around a black screen with a dim rust radial. The call reads as on iOS: restaurant name in serif, meta line with a fixed-width clock, the orb at 250pt, captions (receptionist left in plain text, caller right in a 0.13 white bubble, lookups as small centred pills with a spinner then a check), and round 66pt glass, green and red keys. On phones, the live demo drops the frame and fills the screen.

### The booking pass (signature)
A Wallet-style pass that assembles under the call: rust gradient lit from the bottom left, "Taking details" with a peach dot turning to "Confirmed" with a green dot, a serif title, and four fixed slots (Day, Time, Name, Code). Empty slots show a dash at 0.38 alpha; each fact blurs in (500ms) and then stays.

### Facts band
Two full-bleed band-orange rows of real seed facts (dishes with price and allergens; hours, address, policies) scrolling in opposite directions at 110s and 140s, separated by 5px dots, paused on hover or focus. With reduced motion the rows stop and scroll by hand.

### Race figure
Two calls racing for one table: lanes on a quarter-hour track; the winning bar grows in peach, the losing one grows, shakes and strikes through in an orange outline, then the code chip and spoken line arrive. It plays once on view.

### Motion grammar
One curve everywhere: `cubic-bezier(0.16, 1, 0.3, 1)`. Entrances rise and unblur (hero 24px with 6px blur over 1.2s, staggered 0.14s and 0.26s; the phone rises 120px over 1.6s). Facts blur in from 4px; caption lines rise 8pt over 420ms; the pass unfolds through grid rows over 600ms. Story steps cross-fade with blur over 600 to 900ms, scrubbed to scroll (0.7). Hover transitions are 200ms. With reduced motion, CSS animation and transition collapse to 1ms, the scroll story falls back to the list, and the band stops.

## Do's and Don'ts

### Do:
- **Do** keep every public page on the black ground and light it with radial rust glows from the top or bottom, as on the hero (0.62 alpha), sign-in (0.5) and close (0.42).
- **Do** give each section exactly one serif display or headline line and set everything else in Inter Tight at ink-2 or ink-3.
- **Do** use a white pill for the main action and a black pill for the alternative, uppercase 13px, with the up-right arrow on outbound links.
- **Do** draw edges as 1px inset rings in hair and keep drop shadows for the iPhone alone.
- **Do** set times, codes and clocks in tabular figures.
- **Do** show the assistant as the particle orb, inside the iPhone or bare on black, and keep the poster fallback with its provenance sidecar.
- **Do** drop the iPhone frame on phones (640px and below) so the live call fills the screen.
- **Do** keep the staff dashboard on its own light system, sharing only the rust tint, the call screen, the name and the app icon.

### Don't:
- **Don't** fill pills, slabs or large panels with flat rust or orange; the facts band and the composer's small send button are the only flat orange fills.
- **Don't** put more than one paper (light) slab on a screen.
- **Don't** add a third face to the page's own text or set body copy in the serif; the iOS system face belongs to the iPhone screen only.
- **Don't** draw the orb with outlines, glow sprites or a gradient disc; it is lit by dot density alone.
- **Don't** bring the dashboard's grouped lists, segmented controls or iOS system face into the public pages, or this world's black ground and serif into the dashboard.
