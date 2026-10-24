import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { db } from "@/db";
import { infoEntries, restaurants } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

const validTopics = ["hours", "location", "parking", "delivery", "specials", "policies"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  const restaurantId = (await params).id;
  const url = new URL(request.url);
  const topic = url.searchParams.get("topic");
  const language = url.searchParams.get("language") || "en";

  if (!topic || !validTopics.includes(topic)) {
    return error("invalid_request", "Please provide a valid info topic (hours, location, parking, delivery, specials, policies).", 400);
  }

  // Verify restaurant exists
  let restaurantExists = false;
  if (db) {
    const res = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (res.length > 0) restaurantExists = true;
  }
  if (!restaurantExists && restaurantId === seedData.restaurant.id) {
    restaurantExists = true;
  }
  if (!restaurantExists) {
    return error("not_found", "I couldn't find that restaurant.", 404);
  }

  // Lookup info entry by topic and language
  let answer: string | null = null;
  if (db) {
    // Try requested language first
    const matchLang = await db
      .select()
      .from(infoEntries)
      .where(and(eq(infoEntries.restaurantId, restaurantId), eq(infoEntries.topic, topic), eq(infoEntries.language, language)))
      .limit(1);
    if (matchLang.length > 0) {
      answer = matchLang[0].answer;
    } else {
      // Fallback to English
      const matchEn = await db
        .select()
        .from(infoEntries)
        .where(and(eq(infoEntries.restaurantId, restaurantId), eq(infoEntries.topic, topic), eq(infoEntries.language, "en")))
        .limit(1);
      if (matchEn.length > 0) answer = matchEn[0].answer;
    }
  }

  if (!answer) {
    const fallbackList = seedData.info_entries as any[];
    const matchLang = fallbackList.find(i => i.topic === topic && i.language === language);
    const matchEn = fallbackList.find(i => i.topic === topic && i.language === "en");
    answer = matchLang?.answer || matchEn?.answer || null;
  }

  if (!answer) {
    return error("not_found", "I don't have information on that topic.", 404);
  }

  return NextResponse.json({
    topic,
    summary: answer
  });
}
