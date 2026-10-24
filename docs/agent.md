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

When the call ends, a summary line gives p50 and p95 for `total` and the median of each stage. To compare LLMs, make the same few calls with `LLM_PROVIDER=gemini` and then `groq`, and compare the summaries.

### Week 1 LLM measurements (24 Oct 2026, free tiers, text-only, same prompt)

| Model | First token, turns 1 / 2 / 3 |
|---|---|
| Groq `openai/gpt-oss-20b` | 429 / 136 / 292 ms |
| Gemini `gemini-3.5-flash-lite`, thinking minimal | 1190 / 973 / 1107 ms |
| Gemini `gemini-3.8-flash`, thinking low | 18,257 ms (one turn) |

Groq is the default primary because of this; the brief assumed Gemini. `gemini-3.8-flash` rejects thinking level `minimal`, `gemini-2.5-flash` is closed to new users, and Groq has retired `llama-3.1-8b-instant`. These are small samples from one evening; re-measure by voice before tuning further.

## Mock API

Until the web API is deployed, the agent talks to a mock generated from the contract (from the repo root):

```sh
npx @stoplight/prism-cli mock contracts/openapi.yaml    # http://127.0.0.1:4010
```

Send `Prefer: example=full` or `Prefer: code=422, example=party_too_large` to get the other examples, which is how the scenario tests will cover full slots and large parties. Sample requests are in [contracts/examples/requests.http](../contracts/examples/requests.http).

## Checks

```sh
uv run ruff format . && uv run ruff check . && uv run pytest -q
```

CI runs the same three on every PR that touches `agent/` or `contracts/`.
