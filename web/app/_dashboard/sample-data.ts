import seed from "@/db/seed-data.json";
import type { DashboardData, Dish, Message, Reservation } from "./types";
import { RESTAURANT, addDays, dateKey, weekdayOf } from "./format";
import { sampleCalls } from "./sample-calls";

/* The public demo dashboard runs on this data alone: nothing is read from or written to the
   database. The restaurant's facts (menu, hours, tables, answers) come from the seed file; the
   bookings, messages and calls are made up and placed around the visitor's own clock, so tonight
   always looks like tonight. Every guest, number and code is fake. */

export const SEATING_MINUTES = 90;

type Plan = {
  day: number; // days from today; moved forward past a closed day
  time: string; // restaurant-local HH:MM
  table: string; // table label
  name: string;
  phone: string;
  party: number;
  code: string;
  notes?: string;
  source?: "phone" | "staff";
  callId?: string;
  cancelled?: boolean;
};

// Laid out per table so no two bookings overlap, as the database's exclusion rule guarantees.
const PLANS: Plan[] = [
  { day: -1, time: "19:30", table: "T3", name: "Harsh Vardhan", phone: "+12025550114", party: 4, code: "Q2LD" },
  { day: -1, time: "20:00", table: "T6", name: "Grace Lim", phone: "+14155550176", party: 7, code: "Z8NE", notes: "Team dinner" },
  { day: 0, time: "12:30", table: "T1", name: "Kavya Iyer", phone: "+12025550131", party: 2, code: "B6WS", source: "staff" },
  { day: 0, time: "13:00", table: "T3", name: "Daniel Brooks", phone: "+16465550152", party: 4, code: "R3PX" },
  { day: 0, time: "18:00", table: "T3", name: "Ananya Gupta", phone: "+13125550107", party: 3, code: "H5TM" },
  { day: 0, time: "18:30", table: "T1", name: "Meera Pillai", phone: "+12135550143", party: 2, code: "J9CA", notes: "Window seat if possible" },
  { day: 0, time: "19:00", table: "T2", name: "Vikram Sen", phone: "+12025550188", party: 2, code: "M4T8", notes: "Anniversary celebration" },
  { day: 0, time: "19:15", table: "T4", name: "Rahul Verma", phone: "+17185550165", party: 4, code: "D7KF", notes: "One high chair", source: "staff" },
  { day: 0, time: "19:30", table: "T5", name: "Lakshmi Iyer", phone: "+14155550129", party: 6, code: "W2HB", notes: "Birthday, candle on dessert" },
  { day: 0, time: "19:45", table: "T2", name: "Tom Becker", phone: "+16465550119", party: 2, code: "N8VQ", cancelled: true },
  { day: 0, time: "20:00", table: "T6", name: "Nikhil Kapoor", phone: "+13125550171", party: 8, code: "C5YR" },
  {
    day: 0,
    time: "20:30",
    table: "T3",
    name: "Priya",
    phone: "+12025550147",
    party: 4,
    code: "K7Q2",
    callId: "call_sample_1"
  },
  { day: 0, time: "20:30", table: "T1", name: "Arjun Nair", phone: "+12135550183", party: 2, code: "F3GU" },
  { day: 0, time: "21:00", table: "T2", name: "Sara Thomas", phone: "+17185550190", party: 2, code: "P6XE", source: "staff" },
  { day: 0, time: "21:15", table: "T4", name: "Fatima Khan", phone: "+14155550138", party: 3, code: "T4AJ" },
  { day: 1, time: "19:30", table: "T3", name: "Sneha Reddy", phone: "+12025550161", party: 4, code: "L8RW" },
  { day: 1, time: "20:00", table: "T1", name: "James Okafor", phone: "+16465550124", party: 2, code: "G2ZN" },
  { day: 2, time: "13:00", table: "T5", name: "Aisha Siddiqui", phone: "+13125550146", party: 5, code: "S9DK", source: "staff" },
  { day: 2, time: "20:15", table: "T2", name: "Rohit Das", phone: "+16465550191", party: 2, code: "M4R8", callId: "call_sample_3" },
  { day: 3, time: "19:00", table: "T6", name: "Ishaan Mehra", phone: "+12135550102", party: 8, code: "V7PC", notes: "Office farewell" },
  { day: 4, time: "20:00", table: "T4", name: "Chloe Martin", phone: "+17185550157", party: 4, code: "E5HT" }
];

const TABLE_ID = Object.fromEntries(seed.tables.map(t => [t.label, t.id]));

function minutesToClock(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The day `offset` days from today, moved past closed weekdays (Mondays). Today stays today. */
function openDay(today: string, offset: number) {
  const closed = new Set(seed.opening_hours.filter(h => !h.open).map(h => h.weekday));
  let key = addDays(today, offset);
  while (offset !== 0 && closed.has(weekdayOf(key))) key = addDays(key, offset > 0 ? 1 : -1);
  return key;
}

function reservation(p: Plan, today: string, i: number): Reservation {
  const key = openDay(today, p.day);
  const start = `${key}T${p.time}:00${RESTAURANT.offset}`;
  const [h, m] = p.time.split(":").map(Number);
  const end = `${key}T${minutesToClock(h * 60 + m + SEATING_MINUTES)}:00${RESTAURANT.offset}`;
  return {
    id: `sample-booking-${i + 1}`,
    tableId: p.cancelled ? null : TABLE_ID[p.table],
    tableLabel: p.cancelled ? null : p.table,
    guestName: p.name,
    guestPhone: p.phone,
    partySize: p.party,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    status: p.cancelled ? "cancelled" : "confirmed",
    code: p.code,
    notes: p.notes ?? null,
    source: p.source ?? "phone",
    callId: p.callId ?? null
  };
}

function messages(now: Date): Message[] {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  return [
    {
      id: "sample-message-1",
      callerName: "Karan Malhotra",
      callerPhone: "+14155550117",
      topic: "callback",
      details: "Thinks he left a grey scarf at table T4 last night. Please call back.",
      status: "new",
      createdAt: ago(40)
    },
    {
      id: "sample-message-2",
      callerName: "Rohan",
      callerPhone: "+13125550128",
      topic: "large_party",
      details: "Birthday for 14 on Friday around 8 PM. Asked about the private room.",
      status: "new",
      callId: "call_sample_4",
      createdAt: ago(186)
    },
    {
      id: "sample-message-3",
      callerName: "Meghna Rao",
      callerPhone: "+12025550169",
      topic: "event",
      details: "Book launch for about 40 guests on a weekday evening. Wants to know about a full buyout.",
      status: "new",
      createdAt: ago(320)
    },
    {
      id: "sample-message-4",
      callerName: "Priya Sharma",
      callerPhone: "+12025550192",
      topic: "catering",
      details: "Corporate lunch buffet for 35 people next Thursday. Asked for a vegetarian-heavy menu.",
      status: "in_progress",
      createdAt: ago(1500)
    },
    {
      id: "sample-message-5",
      callerName: "Elena Rossi",
      callerPhone: "+16465550133",
      topic: "other",
      details: "Asked whether the kitchen can do a nut-free tasting menu. Wants a chef to call.",
      status: "resolved",
      createdAt: ago(2900)
    },
    {
      id: "sample-message-6",
      callerName: "Dev Patel",
      callerPhone: "+17185550108",
      topic: "large_party",
      details: "Office dinner for 12 next Friday at 8 PM.",
      status: "resolved",
      createdAt: ago(4300)
    }
  ];
}

/** Everything the dashboard shows, as of `now`. */
export function sampleDashboard(now: Date): DashboardData {
  const today = dateKey(now);
  // One dish waits on its allergens, so the menu shows the rule that keeps it off today's menu.
  const menu: Dish[] = seed.menu.map(d =>
    d.name === "Aloo Gobi" ? { ...d, allergensListed: false, allergens: [], availableToday: false } : d
  );
  // On a closed day (Mondays) tonight stays empty, as it would for real.
  const closedToday = seed.opening_hours.some(h => !h.open && h.weekday === weekdayOf(today));
  return {
    reservations: PLANS.flatMap((p, i) => (closedToday && p.day === 0 ? [] : [reservation(p, today, i)])),
    tables: seed.tables,
    menu,
    hours: seed.opening_hours,
    closures: seed.closures.map(({ id, date, reason }) => ({ id, date, reason })),
    info: seed.info_entries,
    calls: sampleCalls(now),
    messages: messages(now)
  };
}

/** A free table for a booking: the smallest that fits and isn't taken for the whole seating. */
export function freeTable(data: DashboardData, startIso: string, party: number) {
  const start = new Date(startIso).getTime();
  const end = start + SEATING_MINUTES * 60_000;
  const busy = new Set(
    data.reservations
      .filter(r => r.status === "confirmed" && new Date(r.start).getTime() < end && start < new Date(r.end).getTime())
      .map(r => r.tableId)
  );
  return [...data.tables].sort((a, b) => a.capacity - b.capacity).find(t => t.capacity >= party && !busy.has(t.id)) ?? null;
}

/** A booking code like the API's: four characters, no look-alikes (0/O, 1/I). */
export function bookingCode(taken: Set<string>) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    if (!taken.has(code)) return code;
  }
}
