import { NextResponse } from "next/server";
import { db } from "@/db";
import { restaurantTables } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET() {
  const restaurantId = seedData.restaurant.id;
  let list: any[] = [];
  if (db) {
    list = await db
      .select()
      .from(restaurantTables)
      .where(eq(restaurantTables.restaurantId, restaurantId))
      .orderBy(asc(restaurantTables.label));
  } else {
    list = seedData.tables;
  }
  return NextResponse.json({ tables: list });
}
