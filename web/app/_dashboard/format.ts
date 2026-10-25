// Display helpers. All times are shown in the restaurant's timezone; the API owns the date maths.

export const RESTAURANT = {
  id: "6f1c2a9e-3b7d-4c5a-9e2f-1a8b7c6d5e4f",
  name: "The Saffron Table",
  initials: "ST",
  phone: "+14155550123",
  city: "Bengaluru",
  timezone: "Asia/Kolkata",
  offset: "+05:30",
  partyLimit: 8
};

export const LATENCY_BUDGET_MS = 800;

const tz = RESTAURANT.timezone;
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
const shortDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
const shortDayYearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" });
const longDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "7:30 PM" */
export function formatTime(iso: string | Date) {
  return timeFmt.format(new Date(iso));
}

/** "2026-10-25" in the restaurant's timezone */
export function dateKey(d: string | Date = new Date()) {
  return keyFmt.format(new Date(d));
}

/** Noon on that day in the restaurant's timezone, safe for weekday maths. */
export function keyToDate(key: string) {
  return new Date(`${key}T12:00:00${RESTAURANT.offset}`);
}

export function addDays(key: string, days: number) {
  return dateKey(new Date(keyToDate(key).getTime() + days * 86_400_000));
}

/** 0 = Sunday */
export function weekdayOf(key: string) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayFmt.format(keyToDate(key)));
}

/** "Today", "Tomorrow", "Yesterday" or "Sat 7 Nov" */
export function dayLabel(key: string, today = dateKey()) {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  if (key === addDays(today, -1)) return "Yesterday";
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return (sameYear ? shortDayFmt : shortDayYearFmt).format(keyToDate(key));
}

/** "Sunday, 25 October" */
export function longDay(key: string) {
  return longDayFmt.format(keyToDate(key)).replace(/^(\w+) /, "$1, ");
}

/** Minutes since midnight in the restaurant's timezone. */
export function minutesOfDay(iso: string | Date) {
  const [h, m] = hmFmt.format(new Date(iso)).split(":").map(Number);
  return h * 60 + m;
}

/** "21:30:00" → 1290 */
export function clockToMinutes(t: string | null | undefined) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 1290 → "9:30 PM" */
export function minutesToLabel(mins: number, compact = false) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (compact) return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")}`;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "21:30:00" → "21:30" for <input type="time"> */
export function clockToInput(t: string | null | undefined) {
  return t ? t.slice(0, 5) : "";
}

/** "+12025550147" → "+1 202 555 0147" */
export function formatPhone(raw: string | null | undefined) {
  if (!raw) return "";
  const d = raw.replace(/[^\d+]/g, "");
  const us = d.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`;
  const ind = d.match(/^\+91(\d{5})(\d{5})$/);
  if (ind) return `+91 ${ind[1]} ${ind[2]}`;
  return raw;
}

/** 150000 → "2 min 30 s" */
export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

/** "5 min ago", "3 h ago", "Yesterday", "Sat 7 Nov" */
export function relativeTime(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "";
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (dateKey(then) === dateKey(now)) return formatTime(then);
  return dayLabel(dateKey(then), dateKey(now));
}

export function median(values: number[]) {
  return percentile(values, 50);
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function titleCase(s: string) {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const OUTCOME_LABEL: Record<string, string> = {
  booked: "Booked",
  changed: "Changed a booking",
  cancelled: "Cancelled a booking",
  answered: "Answered",
  message_taken: "Took a message",
  transferred: "Transferred to staff",
  hung_up: "Caller hung up",
  failed: "Failed"
};

export const OUTCOME_DOT: Record<string, string> = {
  booked: "dot-green",
  changed: "dot-green",
  cancelled: "",
  answered: "",
  message_taken: "dot-blue",
  transferred: "dot-blue",
  hung_up: "",
  failed: "dot-red"
};

export const TOPIC_LABEL: Record<string, string> = {
  large_party: "Large party",
  event: "Event",
  catering: "Catering",
  callback: "Callback",
  other: "Other"
};

export const MESSAGE_STATUS: { id: string; label: string; dot: string }[] = [
  { id: "new", label: "New", dot: "dot-blue" },
  { id: "in_progress", label: "In progress", dot: "dot-indigo" },
  { id: "resolved", label: "Resolved", dot: "dot-green" }
];

export const DIETARY_LABEL: Record<string, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  gluten_free: "Gluten free",
  dairy_free: "Dairy free"
};

export const ALLERGENS = ["dairy", "nuts", "gluten", "egg", "soy", "fish", "shellfish", "sesame", "mustard"];

export const SPICE_LEVELS = ["none", "mild", "medium", "hot"];
