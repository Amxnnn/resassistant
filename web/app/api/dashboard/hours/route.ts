import { NextResponse } from "next/server";
import { db } from "@/db";
import { closures, openingHours } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET() {
  const restaurantId = seedData.restaurant.id;
  let hoursList: any[] = [];
  let closureList: any[] = [];

  if (db) {
    hoursList = await db.select().from(openingHours).where(eq(openingHours.restaurantId, restaurantId));
    closureList = await db.select().from(closures).where(eq(closures.restaurantId, restaurantId));
  } else {
    hoursList = seedData.opening_hours;
    closureList = seedData.closures;
  }

  return NextResponse.json({ hours: hoursList, closures: closureList });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { weekday, open, openTime, closeTime, lastSeating, addClosure, removeClosureId } = body;
    const restaurantId = seedData.restaurant.id;

    if (db) {
      if (weekday !== undefined) {
        await db
          .update(openingHours)
          .set({
            open: Boolean(open),
            openTime: openTime || null,
            closeTime: closeTime || null,
            lastSeating: lastSeating || null
          })
          .where(and(eq(openingHours.restaurantId, restaurantId), eq(openingHours.weekday, Number(weekday))));
      }

      if (addClosure && addClosure.date && addClosure.reason) {
        await db.insert(closures).values({
          id: crypto.randomUUID(),
          restaurantId,
          date: addClosure.date,
          reason: addClosure.reason
        });
      }

      if (removeClosureId) {
        await db.delete(closures).where(eq(closures.id, removeClosureId));
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Dashboard update hours error:", err);
    return NextResponse.json({ error: err.message || "Failed to update hours." }, { status: 500 });
  }
}
