import { NextResponse } from "next/server";
import { db } from "@/db";
import { reservations, restaurantTables } from "@/db/schema";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import seedData from "@/db/seed-data.json";
import { generateBookingCode, getNowInRestaurantTz, getRestaurant, getTables } from "@/lib/reservations/engine";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const status = url.searchParams.get("status");
  const query = url.searchParams.get("query")?.toLowerCase().trim();

  let list: any[] = [];

  if (db) {
    const conditions: any[] = [];
    if (date) {
      const dStart = new Date(`${date}T00:00:00+05:30`);
      const dEnd = new Date(`${date}T23:59:59+05:30`);
      conditions.push(gte(reservations.start, dStart));
      conditions.push(lte(reservations.start, dEnd));
    }
    if (status && status !== "all") {
      conditions.push(eq(reservations.status, status as any));
    }
    if (query) {
      conditions.push(
        or(
          ilike(reservations.guestName, `%${query}%`),
          ilike(reservations.guestPhone, `%${query}%`),
          ilike(reservations.code, `%${query}%`)
        )
      );
    }

    const rows = await db
      .select({
        id: reservations.id,
        restaurantId: reservations.restaurantId,
        tableId: reservations.tableId,
        tableLabel: restaurantTables.label,
        guestName: reservations.guestName,
        guestPhone: reservations.guestPhone,
        partySize: reservations.partySize,
        start: reservations.start,
        end: reservations.end,
        status: reservations.status,
        code: reservations.code,
        notes: reservations.notes,
        source: reservations.source,
        callId: reservations.callId
      })
      .from(reservations)
      .leftJoin(restaurantTables, eq(reservations.tableId, restaurantTables.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reservations.start));

    list = rows.map(r => ({
      ...r,
      start: r.start.toISOString(),
      end: r.end.toISOString(),
      tableLabel: r.tableLabel || "T1"
    }));
  } else {
    list = (seedData.reservations || []).map((r: any) => ({
      ...r,
      tableLabel: seedData.tables.find(t => t.id === r.tableId)?.label || "T1"
    }));
  }

  return NextResponse.json({ reservations: list });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { restaurant_id, guest_name, guest_phone, party_size, start, table_id, notes } = body;

    if (!restaurant_id || !guest_name || !guest_phone || !party_size || !start) {
      return NextResponse.json({ error: "Missing required booking fields." }, { status: 400 });
    }

    const restaurant = await getRestaurant(restaurant_id);
    const seatingMinutes = restaurant?.seatingMinutes || 90;
    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + seatingMinutes * 60 * 1000);
    const code = generateBookingCode();
    const id = crypto.randomUUID();

    let assignedTableId = table_id;
    if (!assignedTableId) {
      const allTables = await getTables(restaurant_id);
      const fit = allTables.filter((t: any) => t.capacity >= Number(party_size)).sort((a: any, b: any) => a.capacity - b.capacity);
      assignedTableId = fit[0]?.id || allTables[0]?.id;
    }

    if (db) {
      await db.insert(reservations).values({
        id,
        restaurantId: restaurant_id,
        tableId: assignedTableId,
        guestName: guest_name,
        guestPhone: guest_phone,
        partySize: Number(party_size),
        start: startDate,
        end: endDate,
        status: "confirmed",
        code,
        notes: notes || null,
        source: "staff",
        idempotencyKey: crypto.randomUUID()
      });
    }

    return NextResponse.json({
      id,
      code,
      guest_name,
      guest_phone,
      party_size: Number(party_size),
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      status: "confirmed",
      table_id: assignedTableId,
      notes: notes || null
    }, { status: 201 });
  } catch (err: any) {
    console.error("Dashboard create reservation error:", err);
    return NextResponse.json({ error: err.message || "Failed to create reservation." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status, notes, party_size, start, table_id } = body;

    if (!id) {
      return NextResponse.json({ error: "Reservation ID is required." }, { status: 400 });
    }

    if (db) {
      const updates: any = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      if (party_size) updates.partySize = Number(party_size);
      if (table_id) updates.tableId = table_id;
      if (start) {
        const s = new Date(start);
        updates.start = s;
        updates.end = new Date(s.getTime() + 90 * 60 * 1000);
      }

      await db.update(reservations).set(updates).where(eq(reservations.id, id));
    }

    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error("Dashboard update reservation error:", err);
    return NextResponse.json({ error: err.message || "Failed to update reservation." }, { status: 500 });
  }
}
