import { NextResponse } from "next/server";
import { buildCalendar, error, isoNow, requireAgentKey } from "@/lib/agent-api";
import { getRestaurant } from "@/lib/reservations/engine";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET(request: Request, { params }: { params: Promise<{ phone: string }> }) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  const rawPhone = (await params).phone;
  let decodedPhone = decodeURIComponent(rawPhone).trim();
  if (!decodedPhone.startsWith("+")) {
    decodedPhone = "+" + decodedPhone.replace(/^\+*/, "");
  }

  let restaurantRecord: any = null;
  if (db) {
    const found = await db.select().from(restaurants).where(
      or(
        eq(restaurants.phoneNumber, decodedPhone),
        eq(restaurants.phoneNumber, rawPhone)
      )
    ).limit(1);
    if (found.length > 0) restaurantRecord = found[0];
  }

  if (!restaurantRecord) {
    if (decodedPhone === (seedData.restaurant as any).phone_number || decodedPhone === seedData.restaurant.phoneNumber) {
      restaurantRecord = seedData.restaurant;
    }
  }

  if (!restaurantRecord) {
    return error("not_found", "I couldn't find that restaurant.", 404);
  }

  const { calendarDays, openNow } = await buildCalendar(restaurantRecord.id);
  const now = isoNow();

  const summary = openNow
    ? `${restaurantRecord.name} is open right now.`
    : `${restaurantRecord.name} is closed right now. We are open today from 12 to 3 PM and 6 to 11 PM.`;

  return NextResponse.json({
    id: restaurantRecord.id,
    name: restaurantRecord.name,
    phone_number: restaurantRecord.phoneNumber || restaurantRecord.phone_number,
    timezone: restaurantRecord.timezone,
    currency: restaurantRecord.currency,
    languages: restaurantRecord.languages,
    greeting: restaurantRecord.greeting,
    recording_enabled: restaurantRecord.recordingEnabled ?? restaurantRecord.recording_enabled ?? true,
    transfer_number: restaurantRecord.transferNumber ?? restaurantRecord.transfer_number ?? null,
    phone_party_limit: restaurantRecord.phonePartyLimit ?? restaurantRecord.phone_party_limit ?? 8,
    seating_minutes: restaurantRecord.seatingMinutes ?? restaurantRecord.seating_minutes ?? 90,
    address: restaurantRecord.address,
    hours_summary: restaurantRecord.hoursSummary ?? restaurantRecord.hours_summary,
    policies: restaurantRecord.policies,
    open_now: openNow,
    now,
    calendar: calendarDays,
    summary
  });
}
