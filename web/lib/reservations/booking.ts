import { client, db } from "@/db";
import {
  idempotencyKeys,
  reservations,
  restaurantTables,
} from "@/db/schema";
import { eq, and, or, sql, gte } from "drizzle-orm";
import seedData from "@/db/seed-data.json";
import {
  BookingError,
  checkAvailability,
  formatShortTime,
  formatSpeakableTime,
  getDayOfWeek,
  getNowInRestaurantTz,
  getRestaurant,
  getTables,
  parseLocalISO,
  WEEKDAYS,
  generateBookingCode,
} from "./engine";
import { ReservationRecord } from "./types";

export interface CreateReservationInput {
  restaurant_id: string;
  idempotency_key: string;
  guest_name: string;
  guest_phone: string;
  party_size: number;
  start: string;
  notes?: string | null;
  call_id?: string | null;
}

export interface UpdateReservationInput {
  guest_phone?: string | null;
  code?: string | null;
  start?: string;
  party_size?: number;
  notes?: string | null;
}

export interface CancelReservationInput {
  idempotency_key: string;
  guest_phone?: string | null;
  code?: string | null;
  reason?: string | null;
}

const memoryIdempotency = new Map<string, { statusCode: number; body: any }>();
const memoryReservations = new Map<string, any>();

export async function checkIdempotency(key: string, endpoint: string) {
  if (db) {
    const existing = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.endpoint, endpoint)))
      .limit(1);
    if (existing.length > 0) {
      return {
        statusCode: existing[0].statusCode,
        body: existing[0].responseBody
      };
    }
  } else {
    const mem = memoryIdempotency.get(`${endpoint}:${key}`);
    if (mem) return mem;
  }
  return null;
}

export async function saveIdempotency(key: string, endpoint: string, statusCode: number, body: any) {
  memoryIdempotency.set(`${endpoint}:${key}`, { statusCode, body });
  if (db) {
    try {
      await db.insert(idempotencyKeys).values({
        key,
        endpoint,
        statusCode,
        responseBody: body
      }).onConflictDoNothing();
    } catch {
      // Ignored if already saved
    }
  }
}

/**
 * Creates a new confirmed reservation with table assignment and exclusion guard.
 */
export async function createReservation(input: CreateReservationInput): Promise<ReservationRecord> {
  const {
    restaurant_id,
    idempotency_key,
    guest_name,
    guest_phone,
    party_size,
    start,
    notes = null,
    call_id = null
  } = input;

  if (!restaurant_id || !idempotency_key || !guest_name || !guest_phone || !party_size || !start) {
    throw new BookingError("invalid_request", "Missing required booking details.", 400);
  }

  // Idempotency check
  const cached = await checkIdempotency(idempotency_key, "/api/agent/reservations");
  if (cached) {
    return cached.body as ReservationRecord;
  }

  const restaurant = await getRestaurant(restaurant_id);
  if (!restaurant) {
    throw new BookingError("not_found", "I couldn't find that restaurant.", 404);
  }

  // Parse start ISO
  const startDate = new Date(start);
  if (isNaN(startDate.getTime())) {
    throw new BookingError("invalid_request", "Invalid start date-time format.", 400);
  }

  // Extract date and time in restaurant timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: restaurant.timezone || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(startDate);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const dateStr = `${p.year}-${p.month}-${p.day}`;
  const timeStr = `${p.hour}:${p.minute}`;

  // Check availability
  const avail = await checkAvailability(restaurant_id, dateStr, timeStr, party_size);
  if (!avail.requested_time_available) {
    const firstAlt = avail.slots[0]?.label || "another time";
    throw new BookingError("slot_taken", `That time was just booked. ${avail.summary}`, 409);
  }

  // Find candidate tables sorted by capacity ASC
  const allTables = await getTables(restaurant_id);
  const candidateTables = allTables
    .filter((t: any) => t.capacity >= party_size)
    .sort((a: any, b: any) => a.capacity - b.capacity);

  const seatingMinutes = restaurant.seatingMinutes || 90;
  const endDate = new Date(startDate.getTime() + seatingMinutes * 60 * 1000);

  // Pick the first free candidate table
  let assignedTableId = candidateTables[0]?.id;

  if (db) {
    // Check overlapping bookings in db to find the exact free table
    const overlapping = await db.select().from(reservations).where(
      and(
        eq(reservations.restaurantId, restaurant_id),
        eq(reservations.status, "confirmed"),
        sql`tstzrange(${reservations.start}, ${reservations.end}, '[)') && tstzrange(${startDate.toISOString()}::timestamptz, ${endDate.toISOString()}::timestamptz, '[)')`
      )
    );
    const occupiedTableIds = new Set(overlapping.map(o => o.tableId));
    const freeTable = candidateTables.find(t => !occupiedTableIds.has(t.id));

    if (!freeTable) {
      throw new BookingError("slot_taken", "That time was just booked by another caller.", 409);
    }
    assignedTableId = freeTable.id;
  }

  const code = generateBookingCode();
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const timeLabel = formatShortTime(timeStr);
  const summary = `Table for ${party_size}, ${weekday} at ${timeLabel}, code ${code}.`;

  const newId = crypto.randomUUID();
  const record: ReservationRecord = {
    id: newId,
    code,
    restaurant_id,
    guest_name,
    guest_phone,
    party_size,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    status: "confirmed",
    notes: notes ?? null,
    summary
  };

  if (db) {
    try {
      await db.insert(reservations).values({
        id: newId,
        restaurantId: restaurant_id,
        tableId: assignedTableId,
        guestName: guest_name,
        guestPhone: guest_phone,
        partySize: party_size,
        start: startDate,
        end: endDate,
        status: "confirmed",
        code,
        notes: notes ?? null,
        source: "phone",
        callId: call_id ?? null,
        idempotencyKey: idempotency_key
      });
    } catch (err: any) {
      // Postgres exclusion constraint error code 23P01
      if (err?.code === "23P01" || err?.cause?.code === "23P01") {
        throw new BookingError("slot_taken", "That table was just booked by another caller. Please choose another time.", 409);
      }
      throw err;
    }
  } else {
    memoryReservations.set(newId, {
      id: newId,
      restaurantId: restaurant_id,
      tableId: assignedTableId,
      guestName: guest_name,
      guestPhone: guest_phone,
      partySize: party_size,
      start: startDate,
      end: endDate,
      status: "confirmed",
      code,
      notes: notes ?? null,
      source: "phone",
      callId: call_id ?? null,
      idempotencyKey: idempotency_key
    });
  }

  await saveIdempotency(idempotency_key, "/api/agent/reservations", 201, record);
  return record;
}

/**
 * Finds upcoming bookings by phone number or booking code.
 */
export async function findReservations(restaurantId: string, phone?: string | null, code?: string | null) {
  if (!restaurantId || (!phone && !code)) {
    throw new BookingError("invalid_request", "Please provide a phone number or booking code.", 400);
  }

  const { now } = getNowInRestaurantTz();
  let results: any[] = [];

  if (db) {
    const conditions = [
      eq(reservations.restaurantId, restaurantId),
      eq(reservations.status, "confirmed"),
      gte(reservations.end, now)
    ];

    if (phone && code) {
      conditions.push(or(eq(reservations.guestPhone, phone), eq(reservations.code, code.toUpperCase()))!);
    } else if (phone) {
      conditions.push(eq(reservations.guestPhone, phone));
    } else if (code) {
      conditions.push(eq(reservations.code, code.toUpperCase()));
    }

    results = await db.select().from(reservations).where(and(...conditions));
  } else {
    const memList = Array.from(memoryReservations.values());
    const combined = [...(seedData.reservations || []), ...memList];
    results = combined.filter((r: any) => {
      const matchRest = (r.restaurantId || r.restaurant_id) === restaurantId;
      const matchStatus = r.status === "confirmed";
      const matchIdentifier = (phone && (r.guestPhone || r.guest_phone) === phone) || (code && r.code === code?.toUpperCase());
      return matchRest && matchStatus && matchIdentifier;
    });
  }

  const formatted: ReservationRecord[] = results.map(r => {
    const startDate = new Date(r.start);
    const dateStr = startDate.toISOString().split("T")[0];
    const timeStr = startDate.toISOString().split("T")[1].slice(0, 5);
    const weekday = WEEKDAYS[new Date(dateStr).getUTCDay()];
    const timeLabel = formatShortTime(timeStr);
    const summary = `Table for ${r.partySize}, ${weekday} at ${timeLabel}, code ${r.code}.`;

    return {
      id: r.id,
      code: r.code,
      restaurant_id: r.restaurantId,
      guest_name: r.guestName,
      guest_phone: r.guestPhone,
      party_size: r.partySize,
      start: new Date(r.start).toISOString(),
      end: new Date(r.end).toISOString(),
      status: r.status,
      notes: r.notes ?? null,
      summary
    };
  });

  let summary = "";
  if (formatted.length === 0) {
    summary = "I couldn't find any upcoming bookings for that number.";
  } else if (formatted.length === 1) {
    summary = `You have one booking: a table for ${formatted[0].party_size} on ${formatted[0].summary.split(", ")[1]}.`;
  } else {
    summary = `You have ${formatted.length} upcoming bookings. The next one is ${formatted[0].summary}.`;
  }

  return { reservations: formatted, summary };
}

/**
 * Updates an existing booking after verifying ownership.
 */
export async function updateReservation(id: string, input: UpdateReservationInput): Promise<ReservationRecord> {
  const { guest_phone, code, start, party_size, notes } = input;

  if (!guest_phone && !code) {
    throw new BookingError("not_your_reservation", "I can only change bookings made with this phone number or its booking code.", 403);
  }

  let existing: any = null;
  if (db) {
    const found = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (found.length > 0) existing = found[0];
  } else {
    existing = memoryReservations.get(id) || (seedData.reservations || []).find((r: any) => r.id === id);
  }

  if (!existing) {
    throw new BookingError("not_found", "I couldn't find that booking.", 404);
  }

  // Ownership verification
  const phoneMatches = guest_phone && existing.guestPhone === guest_phone;
  const codeMatches = code && existing.code === code.toUpperCase();
  if (!phoneMatches && !codeMatches) {
    throw new BookingError("not_your_reservation", "I can only change bookings made with this phone number or its booking code.", 403);
  }

  if (existing.status === "cancelled") {
    throw new BookingError("already_cancelled", "That booking is already cancelled.", 409);
  }

  const newStart = start ? new Date(start) : new Date(existing.start);
  const newPartySize = party_size ?? existing.partySize;
  const newNotes = notes !== undefined ? notes : existing.notes;

  const restaurant = await getRestaurant(existing.restaurantId);
  const seatingMinutes = restaurant.seatingMinutes || 90;
  const newEnd = new Date(newStart.getTime() + seatingMinutes * 60 * 1000);

  // If time or party size changed, verify capacity
  let assignedTableId = existing.tableId;
  if (start || party_size) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: restaurant.timezone || "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = formatter.formatToParts(newStart);
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const dateStr = `${p.year}-${p.month}-${p.day}`;
    const timeStr = `${p.hour}:${p.minute}`;

    const avail = await checkAvailability(existing.restaurantId, dateStr, timeStr, newPartySize);
    if (!avail.requested_time_available) {
      throw new BookingError("slot_taken", `That time is not available. ${avail.summary}`, 409);
    }

    const allTables = await getTables(existing.restaurantId);
    const candidateTables = allTables
      .filter((t: any) => t.capacity >= newPartySize)
      .sort((a: any, b: any) => a.capacity - b.capacity);

    if (db) {
      const overlapping = await db.select().from(reservations).where(
        and(
          eq(reservations.restaurantId, existing.restaurantId),
          eq(reservations.status, "confirmed"),
          sql`${reservations.id} != ${id}`,
          sql`tstzrange(${reservations.start}, ${reservations.end}, '[)') && tstzrange(${newStart.toISOString()}::timestamptz, ${newEnd.toISOString()}::timestamptz, '[)')`
        )
      );
      const occupiedTableIds = new Set(overlapping.map(o => o.tableId));
      const freeTable = candidateTables.find(t => !occupiedTableIds.has(t.id));
      if (!freeTable) {
        throw new BookingError("slot_taken", "That time is no longer free. Please choose another time.", 409);
      }
      assignedTableId = freeTable.id;
    }
  }

  const dateStr = newStart.toISOString().split("T")[0];
  const timeStr = newStart.toISOString().split("T")[1].slice(0, 5);
  const weekday = WEEKDAYS[new Date(dateStr).getUTCDay()];
  const timeLabel = formatShortTime(timeStr);
  const summary = `Moved to ${weekday} at ${timeLabel}, still a table for ${newPartySize}, code ${existing.code}.`;

  const updated: ReservationRecord = {
    id: existing.id,
    code: existing.code,
    restaurant_id: existing.restaurantId,
    guest_name: existing.guestName,
    guest_phone: existing.guestPhone,
    party_size: newPartySize,
    start: newStart.toISOString(),
    end: newEnd.toISOString(),
    status: "confirmed",
    notes: newNotes,
    summary
  };

  if (db) {
    try {
      await db.update(reservations).set({
        tableId: assignedTableId,
        start: newStart,
        end: newEnd,
        partySize: newPartySize,
        notes: newNotes
      }).where(eq(reservations.id, id));
    } catch (err: any) {
      if (err?.code === "23P01" || err?.cause?.code === "23P01") {
        throw new BookingError("slot_taken", "That table was just booked by another caller.", 409);
      }
      throw err;
    }
  }

  return updated;
}

/**
 * Cancels a booking and frees the table.
 */
export async function cancelReservation(id: string, input: CancelReservationInput): Promise<ReservationRecord> {
  const { idempotency_key, guest_phone, code } = input;

  if (idempotency_key) {
    const cached = await checkIdempotency(idempotency_key, `/api/agent/reservations/${id}/cancel`);
    if (cached) {
      return cached.body as ReservationRecord;
    }
  }

  if (!guest_phone && !code) {
    throw new BookingError("not_your_reservation", "I can only cancel bookings with the caller's phone number or booking code.", 403);
  }

  let existing: any = null;
  if (db) {
    const found = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (found.length > 0) existing = found[0];
  } else {
    existing = memoryReservations.get(id) || (seedData.reservations || []).find((r: any) => r.id === id);
  }

  if (!existing) {
    throw new BookingError("not_found", "I couldn't find that booking.", 404);
  }

  const phoneMatches = guest_phone && existing.guestPhone === guest_phone;
  const codeMatches = code && existing.code === code.toUpperCase();
  if (!phoneMatches && !codeMatches) {
    throw new BookingError("not_your_reservation", "I can only cancel bookings with the caller's phone number or booking code.", 403);
  }

  if (existing.status === "cancelled") {
    throw new BookingError("already_cancelled", "That booking was already cancelled.", 409);
  }

  const startDate = new Date(existing.start);
  const dateStr = startDate.toISOString().split("T")[0];
  const timeStr = startDate.toISOString().split("T")[1].slice(0, 5);
  const weekday = WEEKDAYS[new Date(dateStr).getUTCDay()];
  const timeLabel = formatShortTime(timeStr);
  const summary = `Your table for ${existing.partySize} on ${weekday} at ${timeLabel} is cancelled.`;

  const cancelled: ReservationRecord = {
    id: existing.id,
    code: existing.code,
    restaurant_id: existing.restaurantId,
    guest_name: existing.guestName,
    guest_phone: existing.guestPhone,
    party_size: existing.partySize,
    start: new Date(existing.start).toISOString(),
    end: new Date(existing.end).toISOString(),
    status: "cancelled",
    notes: existing.notes,
    summary
  };

  if (db) {
    await db.update(reservations).set({ status: "cancelled" }).where(eq(reservations.id, id));
  } else {
    existing.status = "cancelled";
    memoryReservations.set(id, existing);
  }

  if (idempotency_key) {
    await saveIdempotency(idempotency_key, `/api/agent/reservations/${id}/cancel`, 200, cancelled);
  }

  return cancelled;
}
