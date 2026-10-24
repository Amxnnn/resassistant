import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { checkIdempotency, saveIdempotency } from "@/lib/reservations/booking";
import { db } from "@/db";
import { calls, callTurns, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

const validChannels = ["phone", "browser"] as const;
const validOutcomes = [
  "booked",
  "changed",
  "cancelled",
  "answered",
  "message_taken",
  "transferred",
  "hung_up",
  "failed"
] as const;

export async function POST(request: Request) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return error("invalid_request", "Invalid JSON request body.", 400);
  }

  const {
    restaurant_id,
    call_id,
    idempotency_key,
    channel,
    caller_number = null,
    dialed_number = null,
    started_at,
    ended_at,
    language = "en",
    outcome,
    recording_url = null,
    turns = []
  } = body;

  if (!restaurant_id || !call_id || !idempotency_key || !channel || !started_at || !ended_at || !outcome) {
    return error("invalid_request", "Missing required call log fields.", 400);
  }

  if (!validChannels.includes(channel)) {
    return error("invalid_request", `Channel must be one of: ${validChannels.join(", ")}`, 400);
  }

  if (!validOutcomes.includes(outcome)) {
    return error("invalid_request", `Outcome must be one of: ${validOutcomes.join(", ")}`, 400);
  }

  // Idempotency check
  const cached = await checkIdempotency(idempotency_key, "/api/agent/calls");
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.statusCode });
  }

  // Verify restaurant
  let restaurantExists = false;
  if (db) {
    const res = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, restaurant_id)).limit(1);
    if (res.length > 0) restaurantExists = true;
  }
  if (!restaurantExists && restaurant_id === seedData.restaurant.id) {
    restaurantExists = true;
  }
  if (!restaurantExists) {
    return error("not_found", "I couldn't find that restaurant.", 404);
  }

  const id = crypto.randomUUID();
  const responseData = {
    id,
    summary: "Call saved."
  };

  if (db) {
    await db.insert(calls).values({
      id,
      restaurantId: restaurant_id,
      callId: call_id,
      channel,
      callerNumber: caller_number,
      dialedNumber: dialed_number,
      startedAt: new Date(started_at),
      endedAt: new Date(ended_at),
      language,
      outcome,
      recordingUrl: recording_url
    });

    if (Array.isArray(turns) && turns.length > 0) {
      for (const turn of turns) {
        await db.insert(callTurns).values({
          id: crypto.randomUUID(),
          callId: id,
          index: turn.index ?? 0,
          speaker: turn.speaker,
          text: turn.text || "",
          at: new Date(turn.at || started_at),
          interrupted: Boolean(turn.interrupted),
          latency: turn.latency ?? null
        });
      }
    }
  }

  await saveIdempotency(idempotency_key, "/api/agent/calls", 201, responseData);

  return NextResponse.json(responseData, { status: 201 });
}
