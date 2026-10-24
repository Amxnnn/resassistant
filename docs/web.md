# Restaurant Voice Agent: Web App & Tool API (`web/`)

Owner: Web Track ([Friend](../.github/CODEOWNERS))  
Version: 1.0.0  
Status: Complete & Portfolio-Ready (Weeks 1–6)

---

## 1. Overview & Architecture

The `web/` track powers the backend tool API, database layer, reservation engine, and real-time management dashboard for **The Saffron Table** AI receptionist.

```
Caller (Phone / Browser)
         │
         ▼
LiveKit Cloud / Voice Agent (Python `agent/`)
         │
         │ HTTP requests carrying `x-agent-key`
         ▼
Next.js App Router API (`web/app/api/agent/*`)
         │
         ├─── Availability & Capacity Engine (`web/lib/reservations/`)
         │         └── Smallest table fitting party size, 15-min slot stepping
         │
         └─── Supabase PostgreSQL with Drizzle ORM (`web/db/`)
                   └── `btree_gist` Exclusion Constraint on `(table_id, tstzrange(start, end, '[)'))`
                            ▲
                            │
               Staff Dashboard (`web/app/page.tsx`)
```

The system strictly adheres to the shared contract at [`contracts/openapi.yaml`](../contracts/openapi.yaml). The agent never touches the database directly, and all date/time maths and validation belong exclusively to this API.

---

## 2. Key Engineering Pillars

### 2.1 Concurrency & Double-Booking Prevention

A common failure mode in restaurant reservation systems is racing callers booking the same table simultaneously. We solve this mathematically at the database layer using a PostgreSQL **exclusion constraint** with `btree_gist`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservations ADD CONSTRAINT reservations_table_time_excl
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(start, "end", '[)') WITH &&
  )
  WHERE (status = 'confirmed');
```

- Range bounds are `[)` (inclusive start, exclusive end), ensuring back-to-back reservations (e.g. 6:00 PM–7:30 PM and 7:30 PM–9:00 PM) do not conflict.
- If two calls race for the last remaining 4-top table at 7:30 PM, the database immediately rejects the overlapping transaction with PostgreSQL error code `23P01`.
- The API catches `23P01` and returns a clean HTTP 409 `slot_taken` error with speakable alternative slots in `error.say`.

### 2.2 Table Allocation & 15-Minute Slot Stepping

The availability engine in [`web/lib/reservations/engine.ts`](../web/lib/reservations/engine.ts) implements the following rules:

1. **Party Limits**: Parties over the restaurant limit (`phonePartyLimit = 8`) are rejected with `party_too_large`, prompting the agent to take a message for the manager.
2. **Smallest Free Table**: For a party of $P$, candidate tables satisfy $\text{capacity} \ge P$, sorted in ascending order of capacity. A party of 2 receives a 2-top table instead of consuming a 4-top or 6-top.
3. **15-Minute Slot Stepping**: Within opening hours and up to `last_seating`, availability is calculated in 15-minute increments.
4. **Closest Alternatives**: When a requested time is taken, the engine searches surrounding slots (e.g. $\pm 15$, $\pm 30$, $\pm 45$ minutes), sorts them by absolute distance from the requested time, and returns up to 3 closest open times formatted for the ear (e.g. *"7:30 is taken. I can do 7 PM, 8:15 or 8:30 for 4."*).

### 2.3 Strict Idempotency

All POST endpoints (`/api/agent/reservations`, `/api/agent/messages`, `/api/agent/calls`, `/api/agent/reservations/{id}/cancel`) require an `idempotency_key` (UUID v4). Replaying an idempotency key immediately returns the cached status and payload, ensuring voice agent network retries never double-book tables or produce duplicate records.

### 2.4 Food Safety & Allergen Guardrails

The voice receptionist answers allergen questions **strictly** from verified restaurant data. The menu editor in the dashboard enforces that dishes cannot be enabled for today's menu without allergen verification:
- `allergens_listed: false` forces the agent to state *"Allergens for [dish] are not listed"* and never infer them from the dish title.
- For severe allergies, the prompt informs the guest to confirm with the host upon arrival.

---

## 3. Database Schema

The database is built on **Supabase PostgreSQL** and modeled via **Drizzle ORM** in [`web/db/schema.ts`](../web/db/schema.ts):

| Table | Key Fields | Purpose |
|---|---|---|
| `restaurants` | `id`, `name`, `phoneNumber`, `timezone`, `phonePartyLimit`, `seatingMinutes`, `hoursSummary`, `policies` | Restaurant core settings and voice configurations |
| `opening_hours` | `restaurantId`, `weekday`, `open`, `openTime`, `closeTime`, `lastSeating` | Weekly schedule (Tuesday–Sunday open, Monday closed) |
| `closures` | `id`, `restaurantId`, `date`, `reason` | Special holiday or private event closures |
| `restaurant_tables` | `id`, `restaurantId`, `label`, `capacity` | Floor plan (T1–T6: two 2-tops, two 4-tops, one 6-top, one 8-top) |
| `reservations` | `id`, `restaurantId`, `tableId`, `guestName`, `guestPhone`, `partySize`, `start`, `end`, `status`, `code`, `idempotencyKey` | Confirmed & cancelled bookings guarded by exclusion constraint |
| `menu_items` | `id`, `restaurantId`, `name`, `category`, `price`, `dietaryTags`, `spiceLevel`, `allergensListed`, `allergens`, `availableToday` | 20-dish menu with required allergen disclosures |
| `info_entries` | `id`, `restaurantId`, `topic`, `answer`, `language` | FAQ answers (parking, hours, specials, delivery) in EN & HI |
| `messages` | `id`, `restaurantId`, `callerName`, `callerPhone`, `topic`, `details`, `status` | Manager inbox for large parties, catering, and callbacks |
| `calls` | `id`, `restaurantId`, `callId`, `channel`, `callerNumber`, `startedAt`, `endedAt`, `language`, `outcome` | Voice call session records and outcomes |
| `call_turns` | `id`, `callId`, `index`, `speaker`, `text`, `at`, `interrupted`, `latency` | Turn-by-turn transcripts and EOU/STT/LLM/TTS timing metrics |
| `idempotency_keys` | `id`, `key`, `endpoint`, `statusCode`, `responseBody`, `createdAt` | Idempotent request replay cache |

---

## 4. Agent Tool API Reference (`/api/agent/*`)

All agent routes validate the shared secret in the `x-agent-key` header (`AGENT_API_KEY`). All errors conform to:
```json
{
  "error": {
    "code": "outside_hours",
    "say": "Our last seating on Saturday is at 9:30 PM. Would 9:30 work?"
  }
}
```

### Endpoints Implemented

1. `GET /api/agent/restaurants/by-number/{phone}`  
   Returns settings, open status, and a dynamic 14-day calendar with opening hours and closures.
2. `GET /api/agent/restaurants/{id}/info?topic=&language=`  
   Returns speakable answers for `hours`, `location`, `parking`, `delivery`, `specials`, and `policies`, with Hindi overrides.
3. `GET /api/agent/restaurants/{id}/menu?query=&dietary=&limit=`  
   Searches dishes by text and dietary requirements (`vegetarian`, `vegan`, `gluten_free`, `dairy_free`, `nut_free`, `jain`), flagging unlisted allergens.
4. `GET /api/agent/restaurants/{id}/availability?date=&time=&party_size=`  
   Checks capacity and returns slot availability or up to 3 closest open slots.
5. `POST /api/agent/reservations`  
   Creates a booking with table assignment and exclusion guard.
6. `GET /api/agent/reservations?restaurant_id=&phone=&code=`  
   Finds upcoming active reservations for a caller.
7. `PATCH /api/agent/reservations/{id}`  
   Modifies time, party size, or notes after verifying phone number or code ownership.
8. `POST /api/agent/reservations/{id}/cancel`  
   Cancels a booking and frees the table, guarded against duplicate cancellations.
9. `POST /api/agent/messages`  
   Saves a message for the restaurant manager.
10. `POST /api/agent/calls`  
    Saves call duration, outcome, full transcript turns, and latency breakdown.
11. `GET|POST /api/livekit-token`  
    Issues LiveKit WebRTC access tokens for browser test calls with `restaurant_phone` participant attribute attached.

---

## 5. Dashboard Features (`web/app/page.tsx`)

The dashboard features a dark glassmorphic design system using Outfit & Inter typography and saffron amber accents:

1. **Tonight's Service**: Table cards (T1–T6) displaying real-time occupancy and tonight's booking schedule.
2. **Reservations Ledger**: Search by guest, phone, or code; status filters; walk-in seating modal; and one-click cancellations.
3. **Menu & Allergen Control**: Category filters, spice meter, dietary tags, price updates, and allergen compliance enforcement.
4. **Hours & Closures**: Weekly schedule editor, holiday closure date picker, and dual-language (EN/HI) FAQ answer editor.
5. **Call Logs & Latency Waterfall**: Inbound call logs with duration, outcome badges, and expandable transcripts showing turn-by-turn EOU, STT, LLM TTFT, and TTS TTFB timings against the 800ms budget.
6. **Manager Inbox**: Messages left for large parties (&gt;8 guests), events, or catering, with status toggling (`New`, `In Progress`, `Resolved`).
7. **Live Call Console**: Built-in browser test call interface with voice/text simulation, live waveform visualizer, real-time transcript streaming, and instant latency verification.
8. **Agent Analytics**: Metrics for booking conversion rate, transfer rate, latency percentiles, and compliance checks.

---

## 6. Local Setup & Testing

### 6.1 Setup

```bash
cd web
pnpm install
cp .env.example .env.local
```

### 6.2 Database & Seed

```bash
# Push schema to Supabase Postgres
pnpm drizzle-kit push

# Seed restaurant, hours, tables, 20 dishes, and sample calls
pnpm db:seed
```

### 6.3 Running Tests

Both unit and contract test suites run out-of-the-box (with or without database connectivity):

```bash
pnpm test
```

### 6.4 Build & Dev

```bash
pnpm dev      # Starts on http://localhost:3000
pnpm build    # Production build
pnpm typecheck
```
