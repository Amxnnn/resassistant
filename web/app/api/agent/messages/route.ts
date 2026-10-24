import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { checkIdempotency, saveIdempotency } from "@/lib/reservations/booking";
import { db } from "@/db";
import { messages, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

const validTopics = ["large_party", "event", "catering", "callback", "other"] as const;

export async function POST(request: Request) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return error("invalid_request", "Invalid JSON request body.", 400);
  }

  const { restaurant_id, idempotency_key, caller_name, caller_phone, topic, details, call_id } = body;

  if (!restaurant_id || !idempotency_key || !caller_name || !caller_phone || !topic || !details) {
    return error("invalid_request", "Missing required fields (restaurant_id, idempotency_key, caller_name, caller_phone, topic, details).", 400);
  }

  if (!validTopics.includes(topic)) {
    return error("invalid_request", `Topic must be one of: ${validTopics.join(", ")}`, 400);
  }

  // Idempotency check
  const cached = await checkIdempotency(idempotency_key, "/api/agent/messages");
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
    summary: "I've passed that to the manager, who will call you back."
  };

  if (db) {
    await db.insert(messages).values({
      id,
      restaurantId: restaurant_id,
      callerName: caller_name,
      callerPhone: caller_phone,
      topic,
      details,
      status: "new",
      callId: call_id ?? null
    });
  }

  await saveIdempotency(idempotency_key, "/api/agent/messages", 201, responseData);

  return NextResponse.json(responseData, { status: 201 });
}
