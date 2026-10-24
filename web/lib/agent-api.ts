import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  closures,
  openingHours,
  restaurants,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";
import { getNowInRestaurantTz, WEEKDAYS } from "./reservations/engine";

export const restaurant = seedData.restaurant;
export const menu = seedData.menu;
export const tables = seedData.tables;

export function requireAgentKey(request: Request) {
  const expected = process.env.AGENT_API_KEY || "dev-agent-key";
  const sent = request.headers.get("x-agent-key");
  if (!sent || sent !== expected) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          say: "Sorry, I'm having trouble reaching our booking system. Can I take a message instead?"
        }
      },
      { status: 401 }
    );
  }
  return null;
}

export function error(code: string, say: string, status = 400) {
  return NextResponse.json({ error: { code, say } }, { status });
}

export function isoNow() {
  return getNowInRestaurantTz().isoString;
}

/**
 * Builds a dynamic 14-day calendar starting today, applying weekly schedule and closures.
 */
export async function buildCalendar(restaurantId: string) {
  const { dateStr: todayStr, timeStr: nowTimeStr } = getNowInRestaurantTz();
  const [startYear, startMonth, startDay] = todayStr.split("-").map(Number);

  // Fetch opening hours & closures
  let hoursList: any[] = [];
  let closureList: any[] = [];

  if (db) {
    hoursList = await db.select().from(openingHours).where(eq(openingHours.restaurantId, restaurantId));
    closureList = await db.select().from(closures).where(eq(closures.restaurantId, restaurantId));
  } else {
    hoursList = seedData.opening_hours;
    closureList = seedData.closures;
  }

  const calendarDays = [];

  for (let i = 0; i < 14; i++) {
    const curDate = new Date(Date.UTC(startYear, startMonth - 1, startDay + i));
    const y = curDate.getUTCFullYear();
    const m = (curDate.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = curDate.getUTCDate().toString().padStart(2, "0");
    const dateKey = `${y}-${m}-${d}`;
    const weekdayIdx = curDate.getUTCDay();
    const weekdayName = WEEKDAYS[weekdayIdx];

    const closure = closureList.find((c: any) => c.date === dateKey);
    const dayHours = hoursList.find((h: any) => h.weekday === weekdayIdx);

    if (closure) {
      calendarDays.push({
        date: dateKey,
        weekday: weekdayName,
        open: false,
        hours: null,
        last_seating: null,
        note: closure.reason
      });
    } else if (!dayHours || !dayHours.open) {
      calendarDays.push({
        date: dateKey,
        weekday: weekdayName,
        open: false,
        hours: null,
        last_seating: null,
        note: `Closed on ${weekdayName}s`
      });
    } else {
      calendarDays.push({
        date: dateKey,
        weekday: weekdayName,
        open: true,
        hours: "12 to 3 PM and 6 to 11 PM",
        last_seating: (dayHours.lastSeating || "21:30").slice(0, 5),
        note: null
      });
    }
  }

  // Determine if open right now
  const todayEntry = calendarDays[0];
  let openNow = false;
  if (todayEntry.open) {
    // 12:00 to 15:00, 18:00 to 23:00
    if ((nowTimeStr >= "12:00" && nowTimeStr <= "15:00") || (nowTimeStr >= "18:00" && nowTimeStr <= "23:00")) {
      openNow = true;
    }
  }

  return { calendarDays, openNow };
}
