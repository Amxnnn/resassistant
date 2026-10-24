# Restaurant Voice Agent: project context

An AI phone receptionist for a restaurant. It takes table reservations, answers menu and hours questions in two languages, and hands off to staff. Two people build it on free tiers and free models. Source: *AI Voice Receptionist for Restaurants: Project Brief* (Aman Kamboj, 24 Oct 2026).

**Status (24 Oct 2026):** Day 0. The repo is bootstrapped with folders, shared root files, env examples and CI stubs. There is no application code yet. The next shared task is `contracts/openapi.yaml` v1, with an example for every endpoint.

**Repo:** https://github.com/Amxnnn/resassistant (Aman is `@Amxnnn`).

**Open decisions:** the second language (Sarvam covers Indian languages), the friend's GitHub username (`@WEB_OWNER` in `.github/CODEOWNERS`), and the friend's name.

---

## MVP scope

- Answers inbound calls, says it is an AI assistant, and offers a staff member at any time
- Answers questions about hours, location, parking, delivery apps and today's specials
- Answers menu questions (dishes, prices, vegetarian or vegan options, spice level). Allergen details come **only** from the restaurant's own data and are never guessed
- Checks availability by party size, date and time, then books, changes or cancels reservations
- Takes a message for the manager about large parties, events and catering
- Speaks English plus one second language
- Dashboard: calls, transcripts, reservations, and editors for the menu and hours

**Out of scope for v1:** takeaway and delivery orders, payments, outbound calls. Phone orders are the first stretch goal.

## Ownership (the rule everything else depends on)

| Path | Owner | Rule |
|---|---|---|
| `agent/`, `docs/agent.md`, `.github/workflows/agent.yml` | Aman (agent track) | Only Aman edits |
| `web/`, `docs/web.md`, `.github/workflows/web.yml` | Friend (web track) | Only the friend edits |
| `contracts/` | Both | Separate PR on a `contract/<change>` branch, approved by both |
| `README.md`, `CLAUDE.md`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.github/CODEOWNERS`, `.github/pull_request_template.md` | Both | Frozen after day 0. Change only by agreement, in a PR that touches nothing else |

- A PR touches only files its author owns. If you need something in the other folder, open an issue.
- The agent **never** touches the database. It talks to the web API over HTTP only.
- Generated code stays in its owner's folder: the Python client goes in `agent/src/agent/api_client/` and the TS types go in `web/`.
- Each side has its own lockfile (`agent/uv.lock`, `web/pnpm-lock.yaml`), `.env.example`, `.gitignore` and path-filtered CI. There is no root `package.json`.

## How a call works

```
Caller (phone or browser test call)
  → LiveKit free US number → LiveKit Cloud (SIP) → agent/ (Python, LiveKit Agents)
       turn detection → STT → LLM (reply or tool call) → TTS
                                   │ HTTP, per contracts/openapi.yaml
                                   ▼
                     web/ tool API (Next.js on Vercel) → Supabase Postgres ← dashboard
```

1. LiveKit puts the call in a room and starts the agent.
2. The agent fetches the restaurant's settings by the dialed number, once per call.
3. On each turn, turn detection decides the guest has finished, STT produces text, the LLM replies or calls a tool, and TTS speaks.
4. Tool calls hit the web API, which checks tables and writes to Postgres.
5. If the guest wants a person, the agent transfers the call to the restaurant's staff number.
6. When the call ends, the agent posts the transcript, outcome, language and per-turn latency, and the call appears in the dashboard.

## Free stack

| Layer | Pick | Free limit | Note / fallback |
|---|---|---|---|
| Voice framework | LiveKit Agents (Python) | Open source | Plugins for Deepgram, Google, Groq, Sarvam: switching provider is one line |
| Agent hosting | LiveKit Cloud Build plan | 1,000 agent min/month, 5 concurrent | Run locally during development |
| Phone number | LiveKit free US number | 1 number, 50 inbound min/month | Do most testing in the browser |
| Turn detection | Silero VAD + LiveKit turn detector | Free | Multilingual detector covers 14 languages |
| STT | Deepgram Nova-3 or Flux | $200 credit, no expiry | Groq Whisper (not streaming, slower) |
| Second language | Sarvam Saaras v3 (STT) + Bulbul v3 (TTS) | ₹100 credit | Indian languages |
| LLM | Gemini Flash / Flash-Lite (AI Studio key) | ~15 req/min, 1,500/day | Free-tier prompts may train Google models, so use **fake data only** |
| LLM backup | Groq (Llama 3.1 8B Instant, GPT-OSS) | 30 req/min; 14,400 req + 500K tokens/day on 8B | Switch to it automatically on a Gemini rate limit |
| TTS | Deepgram Aura-2 | Same Deepgram credit | Cartesia (non-commercial) |
| Web | Next.js (TypeScript), Drizzle, pnpm | — | — |
| DB + auth | Supabase | Free tier | Neon |
| Web hosting | Vercel Hobby | Personal use | — |
| Testing | LiveKit Cloud simulations | 350 text turns, 60 audio turns, 1,000 recording min | Plus our own scenario tests |

The free tiers allow about one call at a time. On a rate limit, retry once and then use Groq. Use made-up restaurants and callers until a paid tier is in place. Cartesia and Vercel Hobby have non-commercial terms.

## The contract (`contracts/openapi.yaml`)

| Method and path | Returns / does | Agent calls it when |
|---|---|---|
| `GET /api/agent/restaurants/by-number/{phone}` | Settings: name, timezone, hours, languages, greeting, transfer number, policies | A call starts |
| `GET /api/agent/restaurants/{id}/info?topic=` | Hours, location, parking, delivery apps, today's specials | The caller asks a general question |
| `GET /api/agent/restaurants/{id}/menu?query=&dietary=` | Matching dishes with price, dietary tags, allergens | The caller asks about the menu |
| `GET /api/agent/restaurants/{id}/availability?date=&time=&party_size=` | Up to 3 open times near the request | The caller wants a table |
| `POST /api/agent/reservations` | Creates a booking; returns id, short code, speakable summary | The caller confirms a time |
| `GET /api/agent/reservations?restaurant_id=&phone=` | The caller's upcoming bookings | The caller wants to change or cancel |
| `PATCH /api/agent/reservations/{id}` | Changes time or party size after re-checking capacity | The caller changes a booking |
| `POST /api/agent/reservations/{id}/cancel` | Cancels and frees the table | The caller cancels |
| `POST /api/agent/messages` | Saves a message for the manager | Large party, event, catering, or staff unavailable |
| `POST /api/agent/calls` | Saves transcript, outcome, language, per-turn latency | A call ends |

**Conventions**
- **Auth:** every request carries an `x-agent-key` header holding the shared secret `AGENT_API_KEY` from both `.env` files.
- **Times:** ISO 8601 with the restaurant's offset, for example `2026-11-07T19:30:00+05:30`. The API owns all date maths and validation, not the LLM.
- **Errors:** one shape everywhere: `{"error": {"code": "slot_taken", "say": "That time was just booked. 8 PM is free."}}`. The agent can speak `say` as-is.
- **Idempotency:** every `POST` carries an `idempotency_key`, so a retry never creates a second booking.
- **Speakable results:** responses include a `summary` written for the ear, for example "Table for 4, Saturday at 7:30 PM, code K7Q2".

**Changing the contract:** use a `contract/<change>` branch that touches only `contracts/`. Prefer additive changes. Both approve, and the PR merges before any code that depends on it. Bump `info.version`, then each side regenerates its own client or types.

**Mock:** `npx @stoplight/prism-cli mock contracts/openapi.yaml` serves on `http://127.0.0.1:4010` by default. The agent switches between the mock and the real API with `API_BASE_URL`.

## Repo layout (planned; folders exist, files arrive with the work)

```
contracts/      openapi.yaml, examples/
agent/          pyproject.toml, uv.lock, Dockerfile, livekit.toml, .env.example
  src/agent/    main.py (entrypoint, AgentSession), tools.py (function tools),
                languages.py (detection, voice per language), metrics.py (per-turn latency),
                prompts/ (system prompt templates per language), api_client/ (generated)
  evals/        scenario tests
web/            package.json, pnpm-lock.yaml, .env.example
  app/api/agent/          tool endpoints implementing the contract
  app/api/livekit-token/  token route for browser test calls
  app/(dashboard)/        reservations, menu, calls, settings
  lib/reservations/       availability and booking logic + tests
  db/                     schema, migrations, seed script
docs/           agent.md, web.md
.github/        CODEOWNERS, pull_request_template.md, workflows/agent.yml, workflows/web.yml
```

**Bootstrap gotcha:** `create-next-app` refuses a target folder that already holds files such as `app/`, `lib/`, `db/` or `.env.example`. Scaffold Next.js in a temp folder and move the files into `web/`.

## Git workflow

- **Branches:** `agent/<task>`, `web/<task>`, `contract/<change>`.
- **Starting a task:** `git switch main && git pull`, then create the branch. On long branches, run `git pull --rebase origin main` at least daily.
- **PRs:** small, merged every day or two, squash-merged. Each person glances at the other's PRs.
- **Protecting `main`:** require a PR and 1 approval, and block direct pushes. Branch protection on a private repo needs a paid GitHub plan, so on GitHub Free the repo must be public.
- **Status checks:** don't make the path-filtered workflows *required*. A workflow skipped by its path filter stays pending and blocks the merge.
- **Secrets:** never commit `.env`. Keep `.env.example` current in your own folder.
- **Integration points:** checkpoints A, B and C are the only times the two tracks must meet.

## Build plan (6 weeks, 8–10 h/week each)

| Week | Agent (Aman) | Web (friend) |
|---|---|---|
| 1 | Run the LiveKit quickstart locally and talk to it in the browser playground. Add Deepgram STT, Gemini Flash and Deepgram Aura. Log end-of-turn, STT, LLM and TTS timings per turn. Start the mock API | Set up Next.js + Supabase + Drizzle. Schema and migrations for every table. Seed one fake restaurant, its tables and a 20-dish menu. Every `/api/agent/*` route returns seed data in the contract shape behind `x-agent-key` |
| 2 | Generate the API client and wrap every endpoint as a function tool. Booking prompt with read-back. Claim the free US number and route calls. Book end to end by phone against the mock | Availability logic with unit tests. Bookings with the exclusion constraint and idempotency keys. Change, cancel and messages endpoints. Deploy to Vercel and share the URL and key |
| **A** | **The agent books through the real API, not the mock** | |
| 3 | Point at the deployed API. Tune turn-detection waits; test interruptions and "mm-hmm". Handle tool errors, silence and hang-ups. Transfer and take-a-message. Post the call log on every call. Groq fallback | Staff login. Today view; reservations list with add, edit and cancel. Menu editor with required allergen fields. Hours, closures and info editors |
| 4 | Second-language STT and TTS, voice switching, language-aware prompt. Test dates, numbers and dish names with native speakers | `POST /api/agent/calls` storing transcripts and per-turn timings. Calls page with transcript and latency per turn. Messages inbox |
| **B** | **Every call appears in the dashboard with its transcript** | |
| 5 | 30–50 scenario tests run on every change. Tune until p50 is under target. Deploy the agent to LiveKit Cloud | LiveKit token route and browser test-call page. Analytics: calls per day, booking rate, transfer rate. Contract tests in CI |
| 6 | One-week pilot; fix the top 5 failures. Demo video. `docs/agent.md` | Enter the pilot's real menu and hours. Polish the UI. `docs/web.md` |
| **C** | **Live demo, README and both write-ups ready** | |

## Agent track (`agent/`)

**Goal:** reply in under ~800 ms, keep the thread when interrupted, and never save a wrong booking.

**On each call:** read the dialed number from the caller's SIP participant and fetch the settings. Build the system prompt from a template: name, hours, policies, languages, and today's date and time in the restaurant's timezone. The session runs Silero VAD + turn detector → Deepgram STT → Gemini Flash (Groq fallback) → Aura for English or Bulbul for the second language. Tools are typed, with clear descriptions, and return the API's `summary` or `say`. At the end of the call, `POST /api/agent/calls`.

**Prompt rules**
- Keep replies to one or two short sentences, and ask one question at a time.
- Before booking, read back the name, party size, day and time, and wait for a yes. Read phone numbers back in small groups of digits.
- Never invent dishes, prices or allergens. If a tool result doesn't contain the answer, offer to take a message or transfer.
- Say it is an AI assistant at the start, and offer staff whenever asked.
- Reply in the caller's language, and mirror them if they mix two.

**Latency budget** (voice-to-voice p50 < 800 ms)

| Stage | Typical | Target |
|---|---|---|
| End-of-turn detection | 150–400 ms | ~200 ms |
| STT final transcript | 100–300 ms | ~150 ms |
| LLM time to first token | 350–1,000 ms | ~400 ms |
| TTS first audio | 90–200 ms | ~100 ms |
| Network, all hops | 50–200 ms | ~50 ms |

How to hit it: stream every stage. Keep the system prompt short and turn reasoning mode off. Trim old history. Say "Let me check" before slow tool calls. Log every stage on every turn. Measure Gemini and Groq side by side.

**Turn-taking:** use the turn detector, not silence alone, and allow a longer wait while collecting phone numbers, names and dates. On barge-in, stop at once and remember only what was actually said. "mm-hmm" must not stop the agent; "no, wait" must. Turn on noise cancellation.

**Second language:** use a multilingual STT that reports the detected language (or Sarvam Saaras) and switch the TTS voice to match. If the language isn't one of the turn detector's 14, tune the VAD waits. Boost dish names and local street names with keyterm prompting.

**Free-tier survival:** on a rate limit, retry once after a short pause, then use Groq for the rest of the call. Fetch settings once per call. Keep the prompt lean, because Groq caps tokens per day and every turn resends the prompt.

## Web track (`web/`)

**Goal:** booking logic that is always correct, and a dashboard staff actually want to open.

**Reservation rules**
- Seat a party at the smallest free table that fits.
- Seating length is a per-restaurant setting (for example 90 min), longer for big parties.
- Offer slots in 15-minute steps within opening hours, up to the last seating.
- Closures (holidays, private events) block all bookings.
- Above the phone party limit, the API tells the agent to take a message.
- No double-booking: a Postgres **exclusion constraint** on table + time range rejects overlaps, even when two calls race.
- When the requested time is full, return the 3 closest open times.

**Data model**

| Table | Key fields |
|---|---|
| `restaurants` | name, phone number, timezone, languages, greeting, transfer number, phone party limit, seating minutes |
| `opening_hours` | restaurant, weekday, open, close, last seating |
| `closures` | restaurant, date, reason |
| `tables` | restaurant, label, capacity |
| `reservations` | restaurant, table, guest name, guest phone, party size, start, end, status, code, notes, source (phone/staff), call, idempotency key |
| `menu_items` | restaurant, name, category, price, description, dietary tags, allergens, available today |
| `info_entries` | restaurant, topic (parking, delivery, specials), answer, per-language overrides |
| `messages` | restaurant, caller name, phone, topic, details, status |
| `calls` | restaurant, caller number, start, end, language, outcome, recording link |
| `call_turns` | call, speaker, text, timestamp, STT ms, LLM first-token ms, TTS ms |

**Dashboard pages:** Today (tonight's bookings by table and time), Reservations (search, add, edit, cancel), Menu (allergen fields required before a dish goes live), Info and hours, Calls (transcript, audio, per-turn latency), Messages inbox, and Test call (browser call using a token from `app/api/livekit-token/`).

## Testing

The agent track owns the scenario suite in `agent/evals/`. The web track owns the API and contract tests in `web/`.

**Scenarios (30–50):**
- Happy paths: book, change the time, cancel, hours or parking
- Menu questions: "what's vegan?", spice level, "does the pasta have nuts?"
- Vague requests: "Saturday evening for a few people", "the usual time"
- Full slot: offer the nearest times
- A party over the phone limit: take a message
- The caller changes their mind, interrupts, or switches language
- A noisy background, a silent caller, a hang-up mid-booking, a call while closed
- Trying to cancel someone else's booking, or telling the agent to ignore its rules
- Asking about a dish or allergen that isn't in the data: the agent must not guess

| Metric | How | Target |
|---|---|---|
| Task success | Share of scenarios where the goal was met | ≥ 90% |
| Booking accuracy | Saved name, phone, party size and time all correct | 100% on the test set |
| Voice-to-voice latency | Caller stops speaking → first agent audio, p50/p95 | p50 < 800 ms |
| Unsupported answers | Claims about dishes, prices or allergens not in the data | Zero |
| Correct handoff | Transfers or takes a message when it should | 100% when asked |

**Layers:**
1. Text simulations (pytest against the mock, plus LiveKit Cloud's text simulations) that check which tools were called and with what arguments.
2. Voice tests with friends phoning in from scripts, including native speakers.
3. A weekly review of calls that ended in a transfer, message or hang-up, turning each failure into a new scenario.

## Compliance and safety

- **Every call:** open with the restaurant's name, that this is an AI assistant, and how to reach staff. Give a recording notice, and make recording a per-restaurant setting. Collect only the name, phone number and booking details. Set a retention period and delete old recordings automatically.
- **Allergens:** answer only from menu data, never inferred from a dish's name. For severe allergies, always tell the guest to confirm with staff on arrival and offer a transfer. Missing data is "not listed", never a guess.
- **Privacy:** India's DPDP Act 2023 covers names, numbers and recordings. The Rules were notified on 13 Nov 2025, and most duties apply from May 2027. Keep real customer data off free LLM tiers.
- **No payments on the call.** Never take card numbers or OTPs.
- **Inbound only in v1.** TRAI's Sept 2026 amendment treats AI calls as automated calls.
- **Guardrails in code, not just the prompt:** the server enforces who can change which booking. The agent discusses only bookings linked to the caller's own number or confirmation code.

## Costs

Building, testing and demoing cost $0. Paying starts with a local number (Exotel/Plivo), more than one concurrent call (a paid LLM tier), exhausted credits, more than 1,000 agent min/month (LiveKit Ship plan, $50/month), or commercial use. A paid setup runs about $0.048 per call-minute, so 1,000 two-minute calls cost about $96/month before carrier fees.

## Portfolio deliverables and stretch goals

**Deliverables:**
- A demo link (browser test call) and the free US number, both pointed at a fake restaurant
- A 2-minute video showing a booking in two languages, an interruption, a full slot and a handoff, with latency on screen
- A README with an architecture diagram
- Both write-ups: agent latency and evals; web booking rules, the double-booking constraint and the dashboard
- Pilot numbers

**Stretch goals:**
- Takeaway phone orders
- WhatsApp confirmations
- Multi-restaurant self-serve onboarding
- A speech-to-speech model comparison
- Owner insights

## Working rules for AI assistants in this repo

- Work out which track a task belongs to and keep changes inside that track's folders. Never mix `agent/`, `web/` and `contracts/` in one change.
- Date and time maths belongs in the API, never in the agent or the prompt.
- Fixtures and seeds use fake restaurants and callers only.
- Never commit `.env` files or secrets. Add new variables to the owning folder's `.env.example`.
