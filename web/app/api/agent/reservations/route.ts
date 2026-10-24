import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { createReservation, findReservations } from "@/lib/reservations/booking";
import { BookingError } from "@/lib/reservations/engine";

export async function GET(request: Request) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurant_id");
  const phone = url.searchParams.get("phone");
  const code = url.searchParams.get("code");

  if (!restaurantId || (!phone && !code)) {
    return error("invalid_request", "Please provide restaurant_id and at least one of phone or code.", 400);
  }

  try {
    const result = await findReservations(restaurantId, phone, code);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof BookingError) {
      return error(err.code, err.say, err.statusCode);
    }
    console.error("Find reservations error:", err);
    return error("internal_error", "Sorry, I had trouble looking up upcoming bookings.", 500);
  }
}

export async function POST(request: Request) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return error("invalid_request", "Invalid JSON request body.", 400);
  }

  if (
    !body.restaurant_id ||
    !body.idempotency_key ||
    !body.guest_name ||
    !body.guest_phone ||
    !body.party_size ||
    !body.start
  ) {
    return error("invalid_request", "Missing required booking details (restaurant_id, idempotency_key, guest_name, guest_phone, party_size, start).", 400);
  }

  try {
    const record = await createReservation({
      restaurant_id: body.restaurant_id,
      idempotency_key: body.idempotency_key,
      guest_name: body.guest_name,
      guest_phone: body.guest_phone,
      party_size: Number(body.party_size),
      start: body.start,
      notes: body.notes ?? null,
      call_id: body.call_id ?? null
    });
    return NextResponse.json(record, { status: 201 });
  } catch (err: any) {
    if (err instanceof BookingError) {
      return error(err.code, err.say, err.statusCode);
    }
    console.error("Create reservation error:", err);
    return error("internal_error", "Sorry, I'm having trouble creating that reservation right now.", 500);
  }
}
