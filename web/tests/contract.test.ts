import { describe, it, expect } from "vitest";
import { GET as getRestaurantByNumber } from "@/app/api/agent/restaurants/by-number/[phone]/route";
import { GET as getInfo } from "@/app/api/agent/restaurants/[id]/info/route";
import { GET as getMenu } from "@/app/api/agent/restaurants/[id]/menu/route";
import { GET as getAvailability } from "@/app/api/agent/restaurants/[id]/availability/route";
import { GET as getReservations, POST as createReservationRoute } from "@/app/api/agent/reservations/route";
import { PATCH as updateReservationRoute } from "@/app/api/agent/reservations/[id]/route";
import { POST as cancelReservationRoute } from "@/app/api/agent/reservations/[id]/cancel/route";
import { POST as createMessageRoute } from "@/app/api/agent/messages/route";
import { POST as createCallRoute } from "@/app/api/agent/calls/route";
import seedData from "@/db/seed-data.json";

const RESTAURANT_ID = seedData.restaurant.id;
const PHONE = (seedData.restaurant as any).phoneNumber || (seedData.restaurant as any).phone_number || "+14155550123";
const AGENT_KEY = process.env.AGENT_API_KEY || "dev-agent-key";

function mockRequest(url: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}) {
  const headers = new Headers();
  headers.set("x-agent-key", options.headers?.["x-agent-key"] ?? AGENT_KEY);
  if (options.body) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

describe("Agent Tool API Contract Conformance", () => {
  describe("GET /api/agent/restaurants/by-number/{phone}", () => {
    it("returns 401 when x-agent-key is missing or wrong", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/by-number/${encodeURIComponent(PHONE)}`, {
        headers: { "x-agent-key": "invalid-secret" }
      });
      const res = await getRestaurantByNumber(req, { params: Promise.resolve({ phone: encodeURIComponent(PHONE) }) });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("unauthorized");
      expect(typeof data.error.say).toBe("string");
    });

    it("returns 404 when phone is not recognized", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/by-number/%2B19999999999`);
      const res = await getRestaurantByNumber(req, { params: Promise.resolve({ phone: "%2B19999999999" }) });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe("not_found");
    });

    it("returns 200 with full RestaurantSettings and 14-day calendar", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/by-number/${encodeURIComponent(PHONE)}`);
      const res = await getRestaurantByNumber(req, { params: Promise.resolve({ phone: encodeURIComponent(PHONE) }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(RESTAURANT_ID);
      expect(data.name).toBe("The Saffron Table");
      expect(data.timezone).toBe("Asia/Kolkata");
      expect(data.currency).toBe("INR");
      expect(Array.isArray(data.languages)).toBe(true);
      expect(Array.isArray(data.policies)).toBe(true);
      expect(Array.isArray(data.calendar)).toBe(true);
      expect(data.calendar.length).toBe(14);
      expect(typeof data.summary).toBe("string");
    });
  });

  describe("GET /api/agent/restaurants/{id}/info", () => {
    it("returns 400 for invalid topic", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/${RESTAURANT_ID}/info?topic=secret_recipes`);
      const res = await getInfo(req, { params: Promise.resolve({ id: RESTAURANT_ID }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("invalid_request");
    });

    it("returns 200 for valid topic with summary", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/${RESTAURANT_ID}/info?topic=parking`);
      const res = await getInfo(req, { params: Promise.resolve({ id: RESTAURANT_ID }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.topic).toBe("parking");
      expect(typeof data.summary).toBe("string");
      expect(data.summary).toContain("valet parking");
    });
  });

  describe("GET /api/agent/restaurants/{id}/menu", () => {
    it("returns 200 with dishes and speakable summary", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/${RESTAURANT_ID}/menu?query=tikka`);
      const res = await getMenu(req, { params: Promise.resolve({ id: RESTAURANT_ID }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
      expect(typeof data.summary).toBe("string");
    });

    it("filters dishes by dietary tag", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/${RESTAURANT_ID}/menu?dietary=vegan`);
      const res = await getMenu(req, { params: Promise.resolve({ id: RESTAURANT_ID }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items.length).toBeGreaterThan(0);
      for (const item of data.items) {
        expect(item.dietary_tags).toContain("vegan");
      }
    });
  });

  describe("GET /api/agent/restaurants/{id}/availability", () => {
    it("returns 400 when missing parameters", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/${RESTAURANT_ID}/availability?date=2026-11-07`);
      const res = await getAvailability(req, { params: Promise.resolve({ id: RESTAURANT_ID }) });
      expect(res.status).toBe(400);
    });

    it("returns 422 when party is too large", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/${RESTAURANT_ID}/availability?date=2026-11-07&time=19:30&party_size=15`);
      const res = await getAvailability(req, { params: Promise.resolve({ id: RESTAURANT_ID }) });
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe("party_too_large");
    });

    it("returns 200 with available slots for open dates", async () => {
      const req = mockRequest(`http://localhost:3000/api/agent/restaurants/${RESTAURANT_ID}/availability?date=2026-11-07&time=19:30&party_size=4`);
      const res = await getAvailability(req, { params: Promise.resolve({ id: RESTAURANT_ID }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.requested_time_available).toBe(true);
      expect(data.slots.length).toBe(1);
      expect(data.summary).toContain("7:30 PM is available for 4");
    });
  });

  describe("POST & GET /api/agent/reservations", () => {
    const testIdempotencyKey = crypto.randomUUID();
    const guestPhone = "+12025550999";

    it("creates a booking and replays idempotency key without duplicate creation", async () => {
      const payload = {
        restaurant_id: RESTAURANT_ID,
        idempotency_key: testIdempotencyKey,
        guest_name: "Simran Kaur",
        guest_phone: guestPhone,
        party_size: 2,
        start: "2026-11-07T20:00:00+05:30",
        notes: "Quiet table"
      };

      const req1 = mockRequest("http://localhost:3000/api/agent/reservations", {
        method: "POST",
        body: payload
      });
      const res1 = await createReservationRoute(req1);
      expect(res1.status).toBe(201);
      const booking = await res1.json();
      expect(booking.guest_name).toBe("Simran Kaur");
      expect(booking.code).toBeDefined();
      expect(booking.status).toBe("confirmed");

      // Replay idempotency key
      const req2 = mockRequest("http://localhost:3000/api/agent/reservations", {
        method: "POST",
        body: payload
      });
      const res2 = await createReservationRoute(req2);
      expect(res2.status).toBe(201);
      const replayed = await res2.json();
      expect(replayed.id).toBe(booking.id);
      expect(replayed.code).toBe(booking.code);

      // Find reservation by phone
      const findReq = mockRequest(`http://localhost:3000/api/agent/reservations?restaurant_id=${RESTAURANT_ID}&phone=${encodeURIComponent(guestPhone)}`);
      const findRes = await getReservations(findReq);
      expect(findRes.status).toBe(200);
      const list = await findRes.json();
      expect(list.reservations.length).toBeGreaterThan(0);

      // Cancel reservation
      const cancelReq = mockRequest(`http://localhost:3000/api/agent/reservations/${booking.id}/cancel`, {
        method: "POST",
        body: {
          idempotency_key: crypto.randomUUID(),
          guest_phone: guestPhone,
          code: booking.code
        }
      });
      const cancelRes = await cancelReservationRoute(cancelReq, { params: Promise.resolve({ id: booking.id }) });
      expect(cancelRes.status).toBe(200);
      const cancelled = await cancelRes.json();
      expect(cancelled.status).toBe("cancelled");

      // Repeat cancel returns 409 already_cancelled
      const cancelAgainReq = mockRequest(`http://localhost:3000/api/agent/reservations/${booking.id}/cancel`, {
        method: "POST",
        body: {
          idempotency_key: crypto.randomUUID(),
          guest_phone: guestPhone,
          code: booking.code
        }
      });
      const cancelAgainRes = await cancelReservationRoute(cancelAgainReq, { params: Promise.resolve({ id: booking.id }) });
      expect(cancelAgainRes.status).toBe(409);
      const err = await cancelAgainRes.json();
      expect(err.error.code).toBe("already_cancelled");
    });
  });

  describe("POST /api/agent/messages", () => {
    it("saves a manager message and returns 201 receipt", async () => {
      const payload = {
        restaurant_id: RESTAURANT_ID,
        idempotency_key: crypto.randomUUID(),
        caller_name: "Anita Desai",
        caller_phone: "+12025550777",
        topic: "large_party",
        details: "Dinner for 16 guests on Friday 20 November."
      };
      const req = mockRequest("http://localhost:3000/api/agent/messages", {
        method: "POST",
        body: payload
      });
      const res = await createMessageRoute(req);
      expect(res.status).toBe(201);
      const receipt = await res.json();
      expect(receipt.id).toBeDefined();
      expect(receipt.summary).toContain("passed that to the manager");
    });
  });

  describe("POST /api/agent/calls", () => {
    it("saves a call log with turns and latency", async () => {
      const payload = {
        restaurant_id: RESTAURANT_ID,
        call_id: `call_${Date.now()}`,
        idempotency_key: crypto.randomUUID(),
        channel: "browser",
        caller_number: null,
        dialed_number: null,
        started_at: "2026-10-24T19:00:00+05:30",
        ended_at: "2026-10-24T19:02:00+05:30",
        language: "en",
        outcome: "booked",
        recording_url: null,
        turns: [
          {
            index: 0,
            speaker: "agent",
            text: "Thanks for calling The Saffron Table. How can I help?",
            at: "2026-10-24T19:00:01+05:30",
            interrupted: false,
            latency: null
          },
          {
            index: 1,
            speaker: "caller",
            text: "I want to book a table for two tonight.",
            at: "2026-10-24T19:00:05+05:30",
            interrupted: false,
            latency: null
          },
          {
            index: 2,
            speaker: "agent",
            text: "Table for two is available at 7:30 PM. May I have your name?",
            at: "2026-10-24T19:00:08+05:30",
            interrupted: false,
            latency: {
              eou_ms: 190,
              stt_ms: 120,
              llm_ttft_ms: 380,
              tts_ttfb_ms: 90,
              total_ms: 660,
              llm_model: "gemini-2.5-flash"
            }
          }
        ]
      };
      const req = mockRequest("http://localhost:3000/api/agent/calls", {
        method: "POST",
        body: payload
      });
      const res = await createCallRoute(req);
      expect(res.status).toBe(201);
      const receipt = await res.json();
      expect(receipt.id).toBeDefined();
      expect(receipt.summary).toBe("Call saved.");
    });
  });
});
