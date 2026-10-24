import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { updateReservation } from "@/lib/reservations/booking";
import { BookingError } from "@/lib/reservations/engine";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  if (!body.guest_phone && !body.code) {
    return error("not_your_reservation", "I can only change bookings with the caller's phone number or booking code.", 403);
  }

  try {
    const updated = await updateReservation(id, {
      guest_phone: body.guest_phone,
      code: body.code,
      start: body.start,
      party_size: body.party_size ? Number(body.party_size) : undefined,
      notes: body.notes
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    if (err instanceof BookingError) {
      return error(err.code, err.say, err.statusCode);
    }
    console.error("Update reservation error:", err);
    return error("internal_error", "Sorry, I had trouble updating that reservation.", 500);
  }
}
