// Shapes returned by /api/dashboard/*. Kept loose where the API passes database rows straight through.

export type Reservation = {
  id: string;
  tableId?: string | null;
  tableLabel?: string | null;
  guestName: string;
  guestPhone: string;
  partySize: number;
  start: string;
  end: string;
  status: "confirmed" | "cancelled";
  code: string;
  notes?: string | null;
  source?: string | null;
  callId?: string | null;
};

export type Latency = {
  eou_ms?: number;
  stt_ms?: number;
  llm_ttft_ms?: number;
  tts_ttfb_ms?: number;
  total_ms?: number;
  llm_model?: string;
};

export type Turn = {
  id?: string;
  index: number;
  speaker: "agent" | "caller" | string;
  text: string;
  at: string;
  interrupted?: boolean;
  latency?: Latency | null;
};

export type Call = {
  id: string;
  callId: string;
  channel: "phone" | "browser" | string;
  callerNumber?: string | null;
  dialedNumber?: string | null;
  startedAt: string;
  endedAt: string;
  language: string;
  outcome: string;
  recordingUrl?: string | null;
  turns?: Turn[];
};

export type Message = {
  id: string;
  callerName: string;
  callerPhone: string;
  topic: string;
  details: string;
  status: string;
  callId?: string | null;
  createdAt?: string;
};

export type Dish = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  price: number;
  dietaryTags?: string[];
  spiceLevel?: string | null;
  allergensListed: boolean;
  allergens?: string[];
  availableToday: boolean;
};

export type DayHours = {
  weekday: number;
  open: boolean;
  openTime?: string | null;
  closeTime?: string | null;
  lastSeating?: string | null;
};

export type Closure = { id: string; date: string; reason: string };

export type InfoEntry = { id?: string; topic: string; language: string; answer: string };

export type DiningTable = { id: string; label: string; capacity: number };

export type DashboardData = {
  reservations: Reservation[];
  tables: DiningTable[];
  menu: Dish[];
  hours: DayHours[];
  closures: Closure[];
  info: InfoEntry[];
  calls: Call[];
  messages: Message[];
};

export type Tab = "tonight" | "reservations" | "messages" | "calls" | "menu" | "hours" | "insights";

export type SheetState =
  | { kind: "booking"; id: string }
  | { kind: "new-booking" }
  | { kind: "dish"; id?: string }
  | { kind: "message"; id: string }
  | { kind: "call"; id: string }
  | { kind: "hours"; weekday: number }
  | { kind: "more" };
