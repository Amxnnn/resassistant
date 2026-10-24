export interface Slot {
  start: string;
  label: string;
}

export interface AvailabilityResult {
  date: string;
  time: string;
  party_size: number;
  requested_time_available: boolean;
  slots: Slot[];
  summary: string;
}

export interface ReservationRecord {
  id: string;
  code: string;
  restaurant_id: string;
  guest_name: string;
  guest_phone: string;
  party_size: number;
  start: string;
  end: string;
  status: "confirmed" | "cancelled";
  notes: string | null;
  summary: string;
}

export interface RestaurantData {
  id: string;
  name: string;
  phoneNumber: string;
  timezone: string;
  currency: string;
  languages: string[];
  greeting: string;
  recordingEnabled: boolean;
  transferNumber: string | null;
  phonePartyLimit: number;
  seatingMinutes: number;
  address: string;
  hoursSummary: string;
  policies: string[];
}
