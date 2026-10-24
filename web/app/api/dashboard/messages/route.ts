import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET() {
  let list: any[] = [];
  if (db) {
    list = await db.select().from(messages).orderBy(desc(messages.createdAt));
  } else {
    list = seedData.messages || [];
  }
  return NextResponse.json({ messages: list });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "Message ID and status are required." }, { status: 400 });
    }

    if (db) {
      await db.update(messages).set({ status }).where(eq(messages.id, id));
    }

    return NextResponse.json({ success: true, id, status });
  } catch (err: any) {
    console.error("Dashboard update message error:", err);
    return NextResponse.json({ error: err.message || "Failed to update message." }, { status: 500 });
  }
}
