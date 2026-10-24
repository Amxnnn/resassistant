import { NextResponse } from "next/server";
import { db } from "@/db";
import { infoEntries } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET() {
  const restaurantId = seedData.restaurant.id;
  let list: any[] = [];
  if (db) {
    list = await db.select().from(infoEntries).where(eq(infoEntries.restaurantId, restaurantId));
  } else {
    list = seedData.info_entries;
  }
  return NextResponse.json({ entries: list });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { topic, language = "en", answer } = body;
    const restaurantId = seedData.restaurant.id;

    if (!topic || !answer) {
      return NextResponse.json({ error: "Topic and answer are required." }, { status: 400 });
    }

    if (db) {
      const existing = await db
        .select()
        .from(infoEntries)
        .where(and(eq(infoEntries.restaurantId, restaurantId), eq(infoEntries.topic, topic), eq(infoEntries.language, language)))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(infoEntries)
          .set({ answer })
          .where(eq(infoEntries.id, existing[0].id));
      } else {
        await db.insert(infoEntries).values({
          id: crypto.randomUUID(),
          restaurantId,
          topic,
          language,
          answer
        });
      }
    }

    return NextResponse.json({ success: true, topic, language });
  } catch (err: any) {
    console.error("Dashboard update info error:", err);
    return NextResponse.json({ error: err.message || "Failed to update info entry." }, { status: 500 });
  }
}
