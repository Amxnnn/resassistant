import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { checkAvailability, BookingError } from "@/lib/reservations/engine";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  const restaurantId = (await params).id;
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const time = url.searchParams.get("time");
  const partyParam = url.searchParams.get("party_size");

  if (!date || !time || !partyParam) {
    return error("invalid_request", "Please provide date, time and party_size query parameters.", 400);
  }

  const partySize = parseInt(partyParam, 10);
  if (isNaN(partySize) || partySize <= 0) {
    return error("invalid_request", "Party size must be a positive number.", 400);
  }

  try {
    const result = await checkAvailability(restaurantId, date, time, partySize);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof BookingError) {
      return error(err.code, err.say, err.statusCode);
    }
    console.error("Availability error:", err);
    return error("internal_error", "Sorry, I'm having trouble checking our availability right now.", 500);
  }
}
