import { CalendarClock, CalendarDays, ChartColumn, Clock, Phone, Utensils, Voicemail } from "lucide-react";
import type { Tab } from "./types";

export const NAV: {
  id: Tab;
  label: string;
  short: string;
  icon: typeof Phone;
  group: "Service" | "Restaurant" | "Receptionist";
  inTabBar: boolean;
}[] = [
  { id: "tonight", label: "Tonight", short: "Tonight", icon: CalendarClock, group: "Service", inTabBar: true },
  { id: "reservations", label: "Reservations", short: "Bookings", icon: CalendarDays, group: "Service", inTabBar: true },
  { id: "messages", label: "Messages", short: "Messages", icon: Voicemail, group: "Service", inTabBar: true },
  { id: "menu", label: "Menu", short: "Menu", icon: Utensils, group: "Restaurant", inTabBar: false },
  { id: "hours", label: "Hours & info", short: "Hours", icon: Clock, group: "Restaurant", inTabBar: false },
  { id: "calls", label: "Calls", short: "Calls", icon: Phone, group: "Receptionist", inTabBar: true },
  { id: "insights", label: "Insights", short: "Insights", icon: ChartColumn, group: "Receptionist", inTabBar: false }
];

export const TAB_IDS = NAV.map(n => n.id);
