import { NextResponse } from "next/server";
import { db } from "@/db";
import { calls, callTurns } from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const outcome = url.searchParams.get("outcome");

  let callList: any[] = [];

  if (db) {
    const rawCalls = await db
      .select()
      .from(calls)
      .where(outcome && outcome !== "all" ? eq(calls.outcome, outcome as any) : undefined)
      .orderBy(desc(calls.startedAt));

    for (const c of rawCalls) {
      const turns = await db
        .select()
        .from(callTurns)
        .where(eq(callTurns.callId, c.id))
        .orderBy(asc(callTurns.index));

      callList.push({
        ...c,
        startedAt: c.startedAt.toISOString(),
        endedAt: c.endedAt.toISOString(),
        turns: turns.map(t => ({
          ...t,
          at: t.at.toISOString()
        }))
      });
    }
  } else {
    callList = seedData.calls || [];
  }

  return NextResponse.json({ calls: callList });
}
