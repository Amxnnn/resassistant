# Voice agent (`agent/`)

Owner: agent track (see [.github/CODEOWNERS](../.github/CODEOWNERS))

The full write-up (architecture, latency numbers, eval results, hardest problems) comes in week 6. For now this page covers how to run the agent.

## Setup

Prerequisites: [uv](https://docs.astral.sh/uv/) and the [LiveKit CLI](https://docs.livekit.io/home/cli/) (`winget install astral-sh.uv LiveKit.LiveKitCLI` on Windows).

```sh
cd agent
cp .env.example .env        # then fill in the keys in .env (never in .env.example)
uv sync                     # installs Python 3.12 deps into agent/.venv
uv run python -m agent.main download-files   # once: turn detector + VAD weights
lk cloud auth               # once: links the lk CLI to your LiveKit Cloud project
```

## Run

| Command | What it does | Needs |
|---|---|---|
| `uv run python -m agent.main console` | Talk to the agent from your terminal with your mic and speakers. Fastest loop. | Deepgram, Gemini or Groq |
| `lk agent dev src/agent/main.py` | Joins LiveKit Cloud with hot reload and prints an **Agent console** link where you can talk to it in the browser. | Also LiveKit (via `lk cloud auth`) |

`lk agent dev` registers under a random dev deployment so your test traffic stays separate. The turn detector runs on LiveKit Cloud in this mode and falls back to a local model if the cloud one is unreachable.

Switch the LLM without touching code: set `LLM_PROVIDER=groq` (default) or `gemini` in `.env`, and choose models with `GROQ_MODELS` (comma-separated, tried in order) and `GEMINI_MODEL`. `NOISE_CANCELLATION=off` turns off LiveKit's noise cancellation, for troubleshooting.

## Text chats (Telegram)

The same receptionist answers text chats. [agent/chat/](../agent/src/agent/chat/) runs it in a text-only session with the chat prompt ([receptionist_chat_en.md](../agent/src/agent/prompts/receptionist_chat_en.md)). The tools, booking rules, facts and Groq-to-Gemini fallback are the voice agent's own. Only the wording changes: booking codes and phone numbers are written out instead of spelled for the ear, and there are no "One moment." fillers, since the chat shows "typing…" instead.

| Command | What it does |
|---|---|
| `uv run python -m agent.chat terminal` | Chat with the receptionist in your terminal; `/start` and `/menu` work too. Saves no call log. |
| `uv run python -m agent.chat telegram` | Runs the Telegram bot. It long-polls Telegram, so it needs no public URL or tunnel. |

To set up the bot:
1. In Telegram, create it with @BotFather (`/newbot`), give it the commands `start`, `menu`, `mybookings` and `staff` (`/setcommands`), and turn off `/setjoingroups`.
2. In `agent/.env`, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` (comma-separated; @userinfobot shows yours). Anyone else gets a polite refusal that shows their user ID, so they can be added.
3. `DATA_SOURCE` works as it does for calls. `TELEGRAM_RESTAURANT_PHONE` picks the restaurant, by its number in the API; it defaults to `DEFAULT_RESTAURANT_PHONE`.

How a chat works:
- **One conversation per guest, like a call.** Messages sent within `CHAT_QUIET_SECONDS` (1.5 s) of each other get one reply, and a message that arrives mid-reply waits its turn. After `CHAT_IDLE_MINUTES` (30) of quiet, or a goodbye, the chat is logged (`POST /api/agent/calls` with channel `telegram`), and the next message starts a new one with the greeting.
- **Phone numbers:** a booking needs one. The bot shows a "Share my phone number" button, and a number shared that way is the guest's own (the bot checks the contact is theirs), so it's trusted like caller ID and never read back. A typed number is read back before booking, like a spoken one. The bot remembers shared numbers only while it runs.
- **Commands:** `/menu` sends the whole menu straight from the data, with allergens as entered and "not listed" where they're missing, and no LLM request. `/mybookings` and `/staff` reach the agent as "What bookings do I have?" and "I'd like to leave a message for the staff."
- **Voice notes:** transcribed by Deepgram (Nova-3, the call's `STT_LANGUAGE` and the restaurant's keyterms, on the same credit). The bot shows `I heard: "..."` so a misheard word is easy to correct, then answers as if it were typed. Notes over 30 seconds are turned away; without `DEEPGRAM_API_KEY`, voice notes get a text-only reply.
- **Limits:** 20 messages per 10 minutes and 500 characters per message, per chat. Photos, stickers and files get a "text and voice notes only" reply. Chats share the free LLM budget with calls (see [Free-tier limits](#free-tier-limits)).
- **One copy at a time:** Telegram refuses a second process polling the same bot (HTTP 409), so run the bot in one place only.
- **The web API must accept channel `telegram`** (contract 1.1.0). Until it does, it refuses chat logs; the bot logs a warning and carries on.
- **"Can't reach our booking system":** with `DATA_SOURCE=api`, the web app must be running at `API_BASE_URL` (`cd web && pnpm dev` for `http://localhost:3000`). The bot checks at startup and logs what to fix.

## Telegram calls (testing)

Telegram bots can't take calls, so for testing a Telegram *user* account can answer them with the voice agent. [agent/telegram_call/](../agent/src/agent/telegram_call/) logs the account in, and when someone on `TELEGRAM_ALLOWED_USER_IDS` calls it:
1. It creates a LiveKit room and joins it as the caller ([bridge.py](../agent/src/agent/telegram_call/bridge.py)). LiveKit sends the agent there, as for any call.
2. The phone keeps ringing until the agent is in the room (up to 45 s, for a cold start), then the call is answered.
3. Audio flows both ways as 48 kHz mono, 10 ms frames, with no resampling. The agent greets once the call is connected, so the caller never misses the start of the greeting.
4. When either side hangs up, the other side is hung up too. The call is logged like any other, with channel `telegram`.

Calls from anyone else are left alone, to ring on the account's own devices. A call the bridge didn't answer is never hung up by it, even if it was answered on the phone.

Setup:
1. Use a **spare Telegram account** if you can: this drives a user account through Telegram's API, which Telegram may restrict.
2. At [my.telegram.org](https://my.telegram.org), under API development tools, create an app. Put its `api_id` and `api_hash` in `agent/.env` as `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`. `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must be set too.
3. Run `uv run --group telegram-call python -m agent.telegram_call`. The first run asks for the account's phone number and the code Telegram sends, then keeps the login in `.telegram_call.session`. That file is the account's whole login: it's in `.gitignore`, so never share it.
4. Make sure an agent is running: `uv run python -m agent.main dev` locally (it has the newest code), or the agent deployed to LiveKit Cloud. When both are up, LiveKit picks one. A deployed agent older than this feature greets before the call connects, so the caller misses the start of the greeting.

Limits: one call at a time, allowed callers only, and the restaurant background hum isn't sent. Replies are a little slower than on a phone line, because the audio crosses Telegram as well as LiveKit. For real guests, use the phone number or WhatsApp Business calling.

## Latency

Every agent reply logs one line:

```
turn 4 latency | total 742 ms | eou 210 | stt 140 | llm ttft 420 (openai/gpt-oss-20b) | tts ttfb 95
```

- `total` is voice-to-voice: from the caller stopping speaking to the agent starting to speak. The target is p50 under 800 ms.
- `eou` is end-of-turn detection, `stt` the final transcript, `llm ttft` the LLM's first token, `tts ttfb` the first audio.

The log also shows each `caller:` and `agent:` line. When the caller cuts in, the agent's line is logged as `agent (INTERRUPTED, stopped after): ...` with only what was actually spoken. Barge-in needs at least two recognised words, so "no, wait" stops the agent but "mm-hmm", a cough or noise doesn't. If an interrupted line is followed by a `caller:` line repeating the agent's own words, the mic is picking up the speakers: use headphones.

When the call ends, a summary line gives p50 and p95 for `total` and the median of each stage. To compare LLMs, make the same few calls with `LLM_PROVIDER=gemini` and then `groq`, and compare the summaries.

[scripts/voice_benchmark.py](../agent/scripts/voice_benchmark.py) measures this over real audio. A scripted caller joins a LiveKit room, speaks five questions (a Deepgram voice, cached), and times the gap to the agent's first sound, while the agent's log gives the per-stage breakdown. Run the agent (and the web app), then `uv run python scripts/voice_benchmark.py`.

### What makes replies fast

- **One TTS piece per reply.** The whole reply goes to the TTS as one piece, and Deepgram starts on the first full sentence (first audio about 0.3 s after its last word). Until 29 Oct 2026, `Receptionist.llm_node` flushed after the first phrase to start a few words sooner, and the voice broke up in demo calls. LiveKit plays each flushed piece to the end before starting the next, and every Aura piece opens with 20–390 ms of silence, so replies paused mid-sentence and the intonation reset at the comma. A short first sentence, which the prompt asks for, keeps the start quick.
- **Facts in the prompt instead of RAG.** The whole knowledge base (about 20 dishes and six info topics, ~500 tokens) is fetched once while the greeting plays ([facts.py](../agent/src/agent/facts.py)) and added to the prompt. Menu and info questions then take one LLM request and no API round trip. RAG would add a retrieval step for a corpus this small. Availability and bookings still go through tools, live.
- **Early voice.** Preemptive generation starts the LLM, and the voice for its reply, before the caller's turn is confirmed.
- **Two Groq models before Gemini.** Groq counts free limits per model, so `gpt-oss-120b` then `gpt-oss-20b` doubles the free budget; Gemini is the last resort.

Measured with the benchmark on 24 Oct 2026, agent clock (caller stops → agent speaks), web app on Supabase in Tokyo:

| Question | Before | After |
|---|---|---|
| Opening hours tomorrow | 3.4–7.6 s | 2.3–2.5 s |
| Vegan dishes | 10.8 s | 1.3–1.4 s |
| Parking | 13.5 s | 1.1–1.2 s |
| Paneer tikka allergens | 14.9 s | 1.8–2.0 s |
| Table on Tuesday (availability tool) | 22.8 s | 9.4–9.9 s |

"Before" was dominated by the LLM: Groq had hit its free limits, so requests went to Gemini, which was taking 5–17 s. After the change, the slow case is the tool path: a ~1.4 s availability query to the database in Tokyo plus extra LLM requests, which on the free tier can hit Groq's per-minute limit. Callers hear about 1.3 s more than the agent clock because of network transit and audio buffering. These runs still split replies at the first phrase. They haven't been re-run since; the voice now also waits for the LLM to finish the first sentence.

### Week 1 LLM measurements (24 Oct 2026, free tiers, text-only, same prompt)

| Model | First token, turns 1 / 2 / 3 |
|---|---|
| Groq `openai/gpt-oss-20b` | 429 / 136 / 292 ms |
| Gemini `gemini-3.5-flash-lite`, thinking minimal | 1190 / 973 / 1107 ms |
| Gemini `gemini-3.8-flash`, thinking low | 18,257 ms (one turn) |

Groq is the default primary because of this; the brief assumed Gemini. `gemini-3.8-flash` rejects thinking level `minimal`, `gemini-2.5-flash` is closed to new users, and Groq has retired `llama-3.1-8b-instant`. These are small samples from one evening; re-measure by voice before tuning further.

## What the agent can do

Tools in [tools.py](../agent/src/agent/tools.py):
- **Info and menu:** hours, location, parking, delivery and specials; menu search with prices, spice, dietary tags and allergens. Missing allergen data is passed on as "not listed", never guessed.
- **Availability:** checks a table; when the time is taken, it says so and offers the three nearest times.
- **Bookings, changes and cancellations:** always two steps. A `prepare_*` tool checks the request and returns a read-back. `confirm_action` carries it out, but refuses to run in the same turn as the prepare, so the caller always gets to say yes first.
- **Phone numbers:** when the phone line gives a caller ID, it's used and anything the LLM passes is ignored. Spoken numbers default to India (+91).
- **Messages and hanging up:** `take_message` leaves a message for the manager (large parties, events, or a caller who wants a person); `end_call` hangs up after the goodbye.
- **Days:** the LLM passes the day as the caller said it ("Tuesday", "tomorrow", "27th"), and `resolve_day` looks it up in the calendar the API sent at call start. Left to itself, the LLM sometimes turned "this Tuesday" into Sunday's date.
- **Phone numbers by voice:** a text transform in front of TTS spaces out any run of 7 or more digits, so numbers are read digit by digit however the LLM wrote them. Numbers read in pairs ("ninety eight, seventy six...", common in India) are understood as well as digit by digit.
- **Looking bookings up:** by the booking code, or by the line's own number (caller ID, or a number a chat guest shared from their own account). A number someone *says* never shows a booking. Anyone could say another guest's number, hear their bookings and codes, and cancel them. The exceptions are bookings made on the same call or chat.
- **Limits checked in code:** a party of zero, a change past the phone party limit, an over-long name or note, and a message without a name or details get a question back instead of an API error.

### Guardrails in code, not just the prompt

The prompt asks the LLM not to invent anything, but a prompt is a request, not a guarantee. [guard.py](../agent/src/agent/guard.py) checks every sentence the LLM writes before the caller hears it (or the chat shows it). The first sentence that fails is replaced with a safe line, and the rest of that reply is dropped:

| Check | Example it stops | Said instead |
|---|---|---|
| Claims a booking, change or cancellation that didn't happen on this call, or is still waiting for a yes | "Perfect, you're all set!" when the LLM skipped `confirm_action` | "Sorry, I haven't done that yet. Shall I go ahead?" |
| A booking code no tool returned and the caller never said | "Your code is K, 7, Q, 9" | "Sorry, I don't have a booking code for that yet." |
| A rupee price that's in neither the restaurant's data nor this conversation | "The lobster is 999 rupees" | "Sorry, I don't have that price." |

The tools say the real confirmations and codes themselves, so a correct reply never trips these checks. The voice waits for a whole sentence before speaking anyway, so the check costs no time. A blocked sentence is logged as `reply guard: ...`.

Prompt injection: the tools only do what the API allows, and the API checks who owns a booking. Restaurant data goes into the prompt as tidy single lines, so a menu entry can't forge a prompt section. And the prompt says nobody (not "the manager", not a "system update") can change the rules in a call or chat. Evals try each of these (below).

### Hearing callers

- **Longer pauses for details.** After the agent asks for a name, a day or time, or how many people, it waits 0.6 s of silence (up to 3 s while the turn detector thinks the caller is mid-thought) instead of 0.3 s. That stops "It's... Priyanka" being cut off after "It's". Phone numbers still get the longest wait (1 s, up to 4 s).
- **When it can't make sense of what it heard, it asks again** rather than guessing. It speaks only English for now and says so.
- **Recognition language** (`STT_LANGUAGE`). A comparison on 13 Indian-accented test clips (Gemini TTS, 2 Nov 2026; Nova-3 streaming with the restaurant's keyterms) scored the words that matter in each clip:

  | Setting | Score | Notes |
  |---|---|---|
  | `en-US` (default) | 96% | Got Priyanka, Venkatesh, Jain, Swiggy; once dropped "table" |
  | `en-IN` | 98% | Heard "Priyanka" as "pre" |
  | `multi` | 78% | Understood Hindi mixed with English ("कल के लिए दो लोगों का table चाहिए"), but wrote "Venkatesh" in Telugu script and heard "Jain" as "Jan" |

  `en-US` and `en-IN` are level within the noise of 13 clips, so the default stays `en-US`. Both English settings turned the Hinglish line into "Logo table", with 0.98 confidence. Confidence therefore can't flag garbled speech, which is why the prompt makes the agent ask again. `TTS_VOICE` picks the Aura-2 voice.

### One id per conversation

Every call gets a fresh id (`call_<32 hex>`, from `new_call_id()` in [tools.py](../agent/src/agent/tools.py)) when it starts. It's attached to:
- every log line, next to the room name
- every booking and message the call creates
- the call log saved when the call ends ([call_log.py](../agent/src/agent/call_log.py)), which holds the transcript, outcome (booked, changed, cancelled, message_taken, answered or hung_up), latency per turn and channel

So in the database each booking traces back to exactly one conversation (`reservations.call_id = calls.call_id`). Room names aren't used for this: console mode reuses one, and a test page can reuse a name it's given. Each call also runs in its own session with its own state, so two people calling at once can't see each other's pending booking or phone number; a unit test interleaves two such calls step by step.

The prompt ([receptionist_en.md](../agent/src/agent/prompts/receptionist_en.md)) keeps the agent to restaurant topics and sets the speaking style. In browser calls, a quiet restaurant background makes it feel like a real front desk. There is no keyboard sound while the agent thinks: the background track plays 0.4 s behind (its buffer), so the typing landed on the first words of nearly every reply and the voice seemed to crackle. Console mode has no background audio.

## Restaurant data

`DATA_SOURCE=sample` (the default) uses a built-in fictional restaurant, The Saffron Table, with the same models, rules and error codes as the contract. Bookings and messages are saved in `agent/.sample_state.json`, so a booking made in one call can be changed in the next; delete the file to reset. Seeded data to test with:
- Mondays are closed, and so is the day 10 days from today.
- Next Saturday's dinner from 7 PM is full for parties of 3 or more.
- Booking code `K7Q2` belongs to Asha Rao, for next Sunday at 1 PM.

`DATA_SOURCE=api` calls the web tool API at `API_BASE_URL` with `AGENT_API_KEY` (see [Running with the web app](#running-with-the-web-app)). Without the web app, you can also point it at a mock of the contract (from the repo root):

```sh
npx @stoplight/prism-cli mock contracts/openapi.yaml    # http://127.0.0.1:4010
```

The models in [api_client/models.py](../agent/src/agent/api_client/models.py) are generated from the contract. After a contract change, regenerate them from `agent/`:

```sh
uv run datamodel-codegen --input ../contracts/openapi.yaml --input-file-type openapi \
  --output src/agent/api_client/models.py --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.12 --use-standard-collections --use-union-operator --field-constraints \
  --collapse-root-models --use-schema-description --use-field-description --disable-timestamp \
  --custom-file-header "# Generated from contracts/openapi.yaml by datamodel-codegen. Do not edit; regenerate (see docs/agent.md)."
uv run ruff format src/agent/api_client/models.py
```

## Running with the web app

The agent and [web/](web.md) meet only over HTTP. The web app's data lives in Supabase (project region ap-northeast-1, Tokyo).

```sh
# web/.env.local: the same AGENT_API_KEY as agent/.env, and DATABASE_URL set to Supabase's
# *session pooler* (Project → Connect → Session pooler), e.g.
#   postgresql://postgres.<project-ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
# The direct db.<project-ref>.supabase.co host is IPv6-only and fails on most home networks.
# URL-encode special characters in the password (@ becomes %40).
cd web
pnpm install
pnpm dev                       # http://localhost:3000, also the staff dashboard

# agent/.env: DATA_SOURCE=api and API_BASE_URL=http://localhost:3000, then talk to it
cd ../agent
uv run python -m agent.main console
```

To work offline instead, run Postgres in Docker and point `DATABASE_URL` at it:

```sh
docker run -d --name resassistant-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=resassistant -p 5433:5432 postgres:17
# DATABASE_URL=postgres://postgres:postgres@localhost:5433/resassistant, then from web/:
pnpm drizzle-kit push --force
docker exec -i resassistant-pg psql -U postgres -d resassistant < db/migrations/0000_reservations_exclusion.sql
pnpm db:seed && git checkout -- db/seed-data.json   # the seed script rewrites this tracked file
```

Bookings, messages and call logs the agent makes show up in the dashboard at http://localhost:3000.

[integration/](../agent/integration/) checks every contract endpoint against the running web app through the agent's own HTTP client. It parses each response with the contract models and covers availability rules, double-booking, ownership, idempotency, and a booking's whole life across routes. It writes fictional "Integration Test" bookings and cancels them. Start the web app, then from `agent/`:

```sh
uv run pytest integration -v
```

[scripts/add_dummy_data.py](../agent/scripts/add_dummy_data.py) fills the web app with fictional test data through the same API: bookings across the coming week, next Saturday 7 PM full for parties of 3 or more, three manager messages, and call logs linked to their bookings by call id. Everything is marked "Dummy data" with 555-01xx numbers. `--remove` cancels the dummy bookings again.

### Response times with Supabase

Measured on 24 Oct 2026 from Bangalore, web app running locally, database in Tokyo (about 130 ms per round trip):

| API call | Time | When the agent makes it |
|---|---|---|
| Restaurant settings | ~0.9 s | once, at call start |
| Info, menu | ~0.6 s | a general or menu question |
| Availability | ~1.4 s | checking a table |
| Create booking | ~3.1 s | after the caller says yes |
| Change booking | ~2.8 s | after the caller says yes |
| Cancel | ~1.2 s | after the caller says yes |

The time is mostly the web API making several database queries one after another, each paying the Tokyo round trip. The agent reuses an availability check from the last 90 seconds instead of repeating it when the caller books, and keyboard sounds play while a tool runs. The big wins are on the web side: a Supabase project in ap-south-1 (Mumbai), queries run in parallel or cached, and booking without re-running the full availability search.

## Deploying to LiveKit Cloud

The agent runs on LiveKit Cloud's free Build plan:
- one deployment
- 5 calls at once
- 1,000 agent minutes a month. This is a hard cap: once it's used up, new calls fail and nothing is charged.

LiveKit builds the image itself from `agent/` with the [Dockerfile](../agent/Dockerfile). The upload leaves out `.env*` files, anything in `.gitignore`, and anything in [.dockerignore](../agent/.dockerignore).

**Region: `us-east` (Ashburn).** The region can't be changed after the agent is created. Every turn calls Deepgram (STT and TTS) and Groq, which are served from the US, so the agent sits next to them. Only the caller's audio crosses the ocean, once each way. In `ap-south` (Mumbai), each turn would pay the India–US round trip three times: for the transcript, the LLM's first token and the first audio.

**Restaurant data:** `DATA_SOURCE=sample` is the fastest choice for a public demo. Tool calls stay inside the agent, with no API or database round trip. Bookings last until the agent restarts or is redeployed.

**Secrets:** LiveKit sets `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` itself and won't accept them as secrets. Put everything else in `agent/.env.production`, which git and the build upload both ignore:
- the Deepgram, Groq and Google keys
- `LLM_PROVIDER`, `GROQ_MODELS`, `GEMINI_MODEL` and `GEMINI_THINKING_LEVEL`
- `MAX_CALL_SECONDS` and `SILENCE_CHECK_IN_SECONDS`
- `DATA_SOURCE=sample`, or `DATA_SOURCE=api` with `API_BASE_URL` set to the web app's production URL and `AGENT_API_KEY`

```sh
cd agent
docker build -t resassistant-agent .                                 # optional: check the image builds
lk agent create --region us-east --secrets-file .env.production      # once: writes livekit.toml, builds, deploys
lk agent deploy                                                      # after each change
lk agent update-secrets --secrets-file .env.production --overwrite   # after changing a secret (restarts the agent)
lk agent logs                                                        # the same latency lines as locally
```

Commit `livekit.toml`. It holds only the project subdomain and the agent id.

**Cold starts:** on the Build plan, LiveKit scales the agent to zero once no call is running. The next call then waits 10–20 s before the agent joins the room. The image already contains compiled bytecode and the model weights, which keeps that wait short. A browser demo page should keep ringing for at least 40 s before it gives up. Paid plans keep the agent warm.

## Free-tier limits

Groq's free tier allows **8,000 tokens per minute and 200,000 tokens per day per model**, and every request resends the prompt, facts and tool list (about 2,500 tokens). That is roughly three requests a minute and 80 a day per model, about 10–15 short calls. A day of heavy testing uses it up, and then every request goes to Gemini, which is much slower. For dependable sub-2-second replies, Groq's pay-as-you-go tier lifts these limits (see Groq's pricing page; short calls use a few thousand tokens). What keeps calls inside the free limits:
- **Fallback:** when both `GROQ_API_KEY` and `GOOGLE_API_KEY` are set, a Groq rate limit hands the request to Gemini immediately instead of failing the turn. Two Gemini quirks are handled in [main.py](../agent/src/agent/main.py): tool calls Groq made get Google's documented stand-in thought signature, and each attempt gets 10 s, because Google rejects request deadlines under 10 s.
- **Small requests:** a short prompt, an 8-day calendar, terse tool descriptions, short replies (under about 30 words), and at most one speculative (preemptive) LLM request per turn. A 600-token cap is only a runaway guard: reasoning tokens count against it, so a tighter cap cuts spoken answers off mid-sentence.
- **Calls end on their own** ([call_limits.py](../agent/src/agent/call_limits.py)): after `SILENCE_CHECK_IN_SECONDS` of silence the agent asks "Are you still there?", and hangs up if the caller stays silent; no call runs past `MAX_CALL_SECONDS`. These lines are fixed text and cost no LLM requests.
- **Usage log:** at the end of each call, a usage line shows the tokens each model used.

## Checks

```sh
uv run ruff format . && uv run ruff check . && uv run pytest -q
```

CI runs the same three on every PR that touches `agent/` or `contracts/`. They need no API keys.

## Conversation tests (evals)

[evals/](../agent/evals/) holds scenarios run with the real LLM against the sample data:
- off-topic and "ignore your rules" requests
- missing allergen data
- a closed day, a full slot, and a party too large
- the full booking flow
- hanging up
- adversarial callers: a "manager" lifting the party limit, asking for the system prompt, a dish that isn't on the menu, a demanded discount, someone else's booking by phone number, garbled speech ("Logo table") and Hindi
- text chats ([test_chat.py](../agent/evals/test_chat.py)): booking with a shared or a typed number, scope, allergens, plain-text answers, goodbye, a message posing as a system update, and someone else's booking by typed number

Each test checks which tools were called, and Gemini judges the reply. Evals use API quota (about 25 requests for the voice set and 15 for the chat set), so they don't run in CI. Run them from `agent/`:

```sh
uv run pytest evals -v
uv run pytest evals/test_chat.py -v    # only the chat scenarios
```
