import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { cancelReservation } from "@/lib/reservations/booking";
import { BookingError } from "@/lib/reservations/engine";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  const id = (await params).id;
  if (!id) return error("invalid_request", "Reservation ID is required.", 400);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return error("invalid_request", "Invalid JSON request body.", 400);
  }

  if (!body.idempotency_key) {
    return error("invalid_request", "idempotency_key is required.", 400);
  }

  if (!body.guest_phone && !body.code) {
    return error("not_your_reservation", "I can only cancel bookings with the caller's phone number or booking code.", 403);
  }

  try {
    const cancelled = await cancelReservation(id, {
      idempotency_key: body.idempotency_key,
      guest_phone: body.guest_phone,
      code: body.code,
      reason: body.reason
    });
    return NextResponse.json(cancelled);
  } catch (err: any) {
    if (err instanceof BookingError) {
      return error(err.code, err.say, err.statusCode);
    }
    console.error("Cancel reservation error:", err);
    return error("internal_error", "Sorry, I had trouble cancelling that reservation.", 500);
  }
}
