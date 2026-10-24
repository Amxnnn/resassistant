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

Switch the LLM without touching code: set `LLM_PROVIDER=groq` (default) or `gemini` in `.env`, and choose models with `GROQ_MODEL` and `GEMINI_MODEL`.

## Latency

Every agent reply logs one line:

```
turn 4 latency | total 742 ms | eou 210 | stt 140 | llm ttft 420 (openai/gpt-oss-20b) | tts ttfb 95
```

- `total` is voice-to-voice: from the caller stopping speaking to the agent starting to speak. The target is p50 under 800 ms.
- `eou` is end-of-turn detection, `stt` the final transcript, `llm ttft` the LLM's first token, `tts ttfb` the first audio.

The log also shows each `caller:` and `agent:` line. When the caller cuts in, the agent's line is logged as `agent (INTERRUPTED, stopped after): ...` with only what was actually spoken. Barge-in needs at least two recognised words, so "no, wait" stops the agent but "mm-hmm", a cough or noise doesn't. If an interrupted line is followed by a `caller:` line repeating the agent's own words, the mic is picking up the speakers: use headphones.

When the call ends, a summary line gives p50 and p95 for `total` and the median of each stage. To compare LLMs, make the same few calls with `LLM_PROVIDER=gemini` and then `groq`, and compare the summaries.

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

The prompt ([receptionist_en.md](../agent/src/agent/prompts/receptionist_en.md)) keeps the agent to restaurant topics and sets the speaking style. In browser calls, a quiet restaurant background and keyboard sounds while a tool works make it feel like a real front desk. Console mode has no background audio.

## Restaurant data

`DATA_SOURCE=sample` (the default) uses a built-in fictional restaurant, The Saffron Table, with the same models, rules and error codes as the contract. Bookings and messages are saved in `agent/.sample_state.json`, so a booking made in one call can be changed in the next; delete the file to reset. Seeded data to test with:
- Mondays are closed, and so is the day 10 days from today.
- Next Saturday's dinner from 7 PM is full for parties of 3 or more.
- Booking code `K7Q2` belongs to Asha Rao, for next Sunday at 1 PM.

`DATA_SOURCE=api` calls the web tool API at `API_BASE_URL` with `AGENT_API_KEY`. Until web/ is deployed, point it at the mock (from the repo root):

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

## Free-tier limits

Groq's free tier allows **8,000 tokens per minute** on `gpt-oss-20b`, and every request resends the prompt and the tool list (about 1,800 tokens). That is roughly four requests a minute. What keeps calls inside it:
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

Each test checks which tools were called, and Gemini judges the reply. Evals use API quota (about 25 requests for the set), so they don't run in CI. Run them from `agent/`:

```sh
uv run pytest evals -v
```
