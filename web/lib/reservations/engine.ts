import { client, db } from "@/db";
import {
  closures,
  openingHours,
  reservations,
  restaurants,
  restaurantTables,
} from "@/db/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import seedData from "@/db/seed-data.json";
import { AvailabilityResult, Slot, ReservationRecord } from "./types";

const TIMEZONE = "Asia/Kolkata";
const TZ_OFFSET = "+05:30";

export class BookingError extends Error {
  code: string;
  statusCode: number;
  say: string;

  constructor(code: string, say: string, statusCode = 422) {
    super(say);
    this.code = code;
    this.statusCode = statusCode;
    this.say = say;
  }
}

export function parseLocalISO(dateStr: string, timeStr: string, offset = TZ_OFFSET): string {
  const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return `${dateStr}T${cleanTime}${offset}`;
}

export function formatSpeakableTime(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute));

  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(d);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(d);
  
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minStr = minute === 0 ? "" : `:${minute.toString().padStart(2, "0")}`;

  return `${weekday}, ${monthName} ${day} at ${hour12}${minStr} ${ampm}`;
}

export function formatShortTime(timeStr: string): string {
  const [hour, minute] = timeStr.split(":").map(Number);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minStr = minute === 0 ? "" : `:${minute.toString().padStart(2, "0")}`;
  return `${hour12}${minStr} ${ampm}`;
}

export function getNowInRestaurantTz(): { now: Date; dateStr: string; timeStr: string; isoString: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }

  const dateStr = `${p.year}-${p.month}-${p.day}`;
  const timeStr = `${p.hour}:${p.minute}`;
  const isoString = `${dateStr}T${p.hour}:${p.minute}:${p.second}${TZ_OFFSET}`;

  return { now, dateStr, timeStr, isoString };
}

export function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  // Date.UTC(year, month - 1, day) day of week
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function generateBookingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous 0, O, 1, I
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function getRestaurant(restaurantId: string) {
  if (db) {
    const res = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (res.length > 0) return res[0];
  }
  return seedData.restaurant as any;
}

export async function getTables(restaurantId: string) {
  if (db) {
    const t = await db.select().from(restaurantTables).where(eq(restaurantTables.id, restaurantId));
    if (t.length > 0) return t;
  }
  return seedData.tables.map((tbl) => ({ ...tbl, restaurantId }));
}

export async function getOpeningHours(restaurantId: string, weekday: number) {
  if (db) {
    const h = await db.select().from(openingHours).where(
      and(eq(openingHours.restaurantId, restaurantId), eq(openingHours.weekday, weekday))
    ).limit(1);
    if (h.length > 0) return h[0];
  }
  const match = seedData.opening_hours.find((o) => o.weekday === weekday);
  return match || { weekday, open: false, openTime: null, closeTime: null, lastSeating: null };
}

export async function getClosure(restaurantId: string, dateStr: string) {
  if (db) {
    const c = await db.select().from(closures).where(
      and(eq(closures.restaurantId, restaurantId), eq(closures.date, dateStr))
    ).limit(1);
    if (c.length > 0) return c[0];
  }
  const match = seedData.closures.find((c) => c.date === dateStr);
  return match || null;
}

export async function getConfirmedReservationsForDate(restaurantId: string, dateStr: string) {
  const dayStart = new Date(parseLocalISO(dateStr, "00:00:00"));
  const dayEnd = new Date(parseLocalISO(dateStr, "23:59:59"));

  if (db) {
    const res = await db.select().from(reservations).where(
      and(
        eq(reservations.restaurantId, restaurantId),
        eq(reservations.status, "confirmed"),
        gte(reservations.end, dayStart),
        lte(reservations.start, dayEnd)
      )
    );
    return res.map(r => ({
      ...r,
      start: r.start.toISOString(),
      end: r.end.toISOString()
    }));
  }

  return (seedData.reservations || [])
    .filter(r => r.restaurantId === restaurantId && r.status === "confirmed")
    .map(r => ({
      ...r,
      start: new Date(r.start).toISOString(),
      end: new Date(r.end).toISOString()
    }));
}

/**
 * Checks table availability and finds closest open slots if the requested slot is full.
 */
export async function checkAvailability(
  restaurantId: string,
  dateStr: string,
  timeStr: string,
  partySize: number
): Promise<AvailabilityResult> {
  const restaurant = await getRestaurant(restaurantId);
  if (!restaurant) {
    throw new BookingError("not_found", "I couldn't find that restaurant.", 404);
  }

  // 1. Party size check
  if (partySize > restaurant.phonePartyLimit) {
    throw new BookingError(
      "party_too_large",
      "For more than 8 guests the manager arranges the booking. I can take your details and have them call you back.",
      422
    );
  }

  // 2. Validate date and time syntax
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) {
    throw new BookingError("invalid_request", "Please provide a valid date (YYYY-MM-DD) and time (HH:MM).", 400);
  }

  const { dateStr: todayStr, timeStr: nowTimeStr } = getNowInRestaurantTz();
  
  // 3. In the past check
  if (dateStr < todayStr || (dateStr === todayStr && timeStr < nowTimeStr)) {
    throw new BookingError("in_the_past", "That time has already passed. Could you choose an upcoming time?", 422);
  }

  // 4. Too far ahead check (30 days limit)
  const [y, m, d] = dateStr.split("-").map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const currentDate = new Date(Date.UTC(ty, tm - 1, td));
  const diffDays = Math.round((targetDate.getTime() - currentDate.getTime()) / (1000 * 3600 * 24));
  if (diffDays > 30) {
    throw new BookingError("too_far_ahead", "We only take reservations up to 30 days in advance.", 422);
  }

  // 5. Special closure check
  const closure = await getClosure(restaurantId, dateStr);
  if (closure) {
    throw new BookingError("closed", `We are closed on ${dateStr} for ${closure.reason}. Would another day work?`, 422);
  }

  // 6. Day of week opening check
  const weekday = getDayOfWeek(dateStr);
  const weekdayName = WEEKDAYS[weekday];
  const hours = await getOpeningHours(restaurantId, weekday);
  if (!hours.open || !hours.openTime || !hours.closeTime) {
    throw new BookingError("closed", `We're closed on ${weekdayName}s. Would another day work instead?`, 422);
  }

  // 7. Operating hours check
  const openTimeShort = hours.openTime.slice(0, 5);
  const lastSeatingShort = (hours.lastSeating || hours.closeTime).slice(0, 5);

  if (timeStr < openTimeShort || timeStr > lastSeatingShort) {
    const formattedLastSeating = formatShortTime(lastSeatingShort);
    throw new BookingError(
      "outside_hours",
      `Our last seating on ${weekdayName} is at ${formattedLastSeating}. Would ${formattedLastSeating} work?`,
      422
    );
  }

  // 8. Find tables and existing bookings
  const allTables = await getTables(restaurantId);
  // Candidate tables are those that can seat this party, ordered by capacity ascending (smallest first)
  const candidateTables = allTables
    .filter((t: any) => t.capacity >= partySize)
    .sort((a: any, b: any) => a.capacity - b.capacity);

  if (candidateTables.length === 0) {
    throw new BookingError("party_too_large", "We don't have tables large enough for that party size.", 422);
  }

  const seatingMinutes = restaurant.seatingMinutes || 90;
  const existingBookings = await getConfirmedReservationsForDate(restaurantId, dateStr);

  // Helper to check if a table is free for a given time window
  function isTableFreeAt(tableId: string, slotStart: Date, slotEnd: Date): boolean {
    for (const b of existingBookings) {
      if (b.tableId === tableId && b.status === "confirmed") {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        // Overlap condition: start1 < end2 && end1 > start2
        if (slotStart < bEnd && slotEnd > bStart) {
          return false;
        }
      }
    }
    return true;
  }

  function findFreeTableForSlot(slotTime: string): { free: boolean; table?: any } {
    const startIso = parseLocalISO(dateStr, slotTime);
    const startDate = new Date(startIso);
    const endDate = new Date(startDate.getTime() + seatingMinutes * 60 * 1000);

    for (const table of candidateTables) {
      if (isTableFreeAt(table.id, startDate, endDate)) {
        return { free: true, table };
      }
    }
    return { free: false };
  }

  // Check requested slot
  const requestedCheck = findFreeTableForSlot(timeStr);

  if (requestedCheck.free) {
    const slotStartIso = parseLocalISO(dateStr, timeStr);
    const label = formatSpeakableTime(dateStr, timeStr);
    const shortLabel = formatShortTime(timeStr);
    const weekdayShort = WEEKDAYS[weekday];

    return {
      date: dateStr,
      time: timeStr,
      party_size: partySize,
      requested_time_available: true,
      slots: [{ start: slotStartIso, label }],
      summary: `${weekdayShort} at ${shortLabel} is available for ${partySize}.`
    };
  }

  // Requested time is full. Find up to 3 closest open slots in 15-minute increments
  const [openH, openM] = openTimeShort.split(":").map(Number);
  const [lastH, lastM] = lastSeatingShort.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const lastMinutes = lastH * 60 + lastM;

  const [reqH, reqM] = timeStr.split(":").map(Number);
  const reqMinutes = reqH * 60 + reqM;

  interface AlternativeSlot {
    minutes: number;
    timeString: string;
    diff: number;
  }

  const alternatives: AlternativeSlot[] = [];

  // Look in increments of 15 minutes within bounds
  for (let m = openMinutes; m <= lastMinutes; m += 15) {
    if (m === reqMinutes) continue;
    const hh = Math.floor(m / 60).toString().padStart(2, "0");
    const mm = (m % 60).toString().padStart(2, "0");
    const candidateTime = `${hh}:${mm}`;

    // If today, cannot suggest slots in past
    if (dateStr === todayStr && candidateTime < nowTimeStr) continue;

    const check = findFreeTableForSlot(candidateTime);
    if (check.free) {
      alternatives.push({
        minutes: m,
        timeString: candidateTime,
        diff: Math.abs(m - reqMinutes)
      });
    }
  }

  // Sort by closest distance to requested time, pick up to 3
  alternatives.sort((a, b) => a.diff - b.diff || a.minutes - b.minutes);
  const top3 = alternatives.slice(0, 3).sort((a, b) => a.minutes - b.minutes);

  const alternativeSlots: Slot[] = top3.map(alt => ({
    start: parseLocalISO(dateStr, alt.timeString),
    label: formatSpeakableTime(dateStr, alt.timeString)
  }));

  const reqShort = formatShortTime(timeStr);
  let summary = "";
  if (top3.length === 0) {
    summary = `Sorry, ${reqShort} is taken and there are no other open tables on that day.`;
  } else if (top3.length === 1) {
    summary = `${reqShort} is taken. I can do ${formatShortTime(top3[0].timeString)} for ${partySize}.`;
  } else if (top3.length === 2) {
    summary = `${reqShort} is taken. I can do ${formatShortTime(top3[0].timeString)} or ${formatShortTime(top3[1].timeString)} for ${partySize}.`;
  } else {
    summary = `${reqShort} is taken. I can do ${formatShortTime(top3[0].timeString)}, ${formatShortTime(top3[1].timeString)} or ${formatShortTime(top3[2].timeString)} for ${partySize}.`;
  }

  return {
    date: dateStr,
    time: timeStr,
    party_size: partySize,
    requested_time_available: false,
    slots: alternativeSlots,
    summary
  };
}
