import { NextResponse } from "next/server";
import { db } from "@/db";
import { calls, callTurns, messages, reservations, restaurantTables } from "@/db/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import seedData from "@/db/seed-data.json";
import { getNowInRestaurantTz } from "@/lib/reservations/engine";

export async function GET() {
  const { dateStr: todayStr, now } = getNowInRestaurantTz();
  const dayStart = new Date(`${todayStr}T00:00:00+05:30`);
  const dayEnd = new Date(`${todayStr}T23:59:59+05:30`);

  let todayReservationsCount = 0;
  let confirmedReservationsCount = 0;
  let totalCallsCount = 0;
  let bookedCallsCount = 0;
  let transferredCallsCount = 0;
  let newMessagesCount = 0;
  let totalTablesCount = 6;
  let avgLatencyMs = 690;
  let p95LatencyMs = 780;

  if (db) {
    // Today reservations
    const todayRes = await db
      .select({ count: sql<number>`count(*)` })
      .from(reservations)
      .where(and(gte(reservations.start, dayStart), sql`${reservations.start} <= ${dayEnd}`));
    todayReservationsCount = Number(todayRes[0]?.count || 0);

    const confRes = await db
      .select({ count: sql<number>`count(*)` })
      .from(reservations)
      .where(and(eq(reservations.status, "confirmed"), gte(reservations.end, now)));
    confirmedReservationsCount = Number(confRes[0]?.count || 0);

    // Calls stats
    const allCalls = await db.select().from(calls);
    totalCallsCount = allCalls.length;
    bookedCallsCount = allCalls.filter(c => c.outcome === "booked").length;
    transferredCallsCount = allCalls.filter(c => c.outcome === "transferred").length;

    // Messages stats
    const unreadMsgs = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.status, "new"));
    newMessagesCount = Number(unreadMsgs[0]?.count || 0);

    // Tables
    const tablesCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(restaurantTables);
    totalTablesCount = Number(tablesCount[0]?.count || 6);

    // Call turns latencies
    const turnsWithLatency = await db
      .select({ latency: callTurns.latency })
      .from(callTurns)
      .where(sql`${callTurns.latency} IS NOT NULL`);
    
    const totals = turnsWithLatency
      .map(t => (t.latency as any)?.total_ms)
      .filter((m: any) => typeof m === "number");

    if (totals.length > 0) {
      totals.sort((a, b) => a - b);
      avgLatencyMs = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
      const p95Idx = Math.floor(totals.length * 0.95);
      p95LatencyMs = totals[p95Idx] || totals[totals.length - 1];
    }
  } else {
    todayReservationsCount = (seedData.reservations || []).length;
    confirmedReservationsCount = todayReservationsCount;
    totalCallsCount = (seedData.calls || []).length;
    bookedCallsCount = 1;
    newMessagesCount = (seedData.messages || []).filter(m => m.status === "new").length;
  }

  const bookingRate = totalCallsCount > 0 ? Math.round((bookedCallsCount / totalCallsCount) * 100) : 75;
  const transferRate = totalCallsCount > 0 ? Math.round((transferredCallsCount / totalCallsCount) * 100) : 10;

  return NextResponse.json({
    today_date: todayStr,
    today_reservations: todayReservationsCount,
    upcoming_confirmed: confirmedReservationsCount,
    total_calls: totalCallsCount,
    booking_rate_percent: bookingRate,
    transfer_rate_percent: transferRate,
    new_messages: newMessagesCount,
    total_tables: totalTablesCount,
    avg_latency_ms: avgLatencyMs,
    p95_latency_ms: p95LatencyMs,
    target_latency_ms: 800
  });
}
