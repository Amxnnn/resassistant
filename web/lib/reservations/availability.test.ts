import { describe, it, expect } from "vitest";
import { checkAvailability, BookingError, formatSpeakableTime, formatShortTime } from "./engine";

const RESTAURANT_ID = "6f1c2a9e-3b7d-4c5a-9e2f-1a8b7c6d5e4f";

describe("Availability Engine", () => {
  it("rejects parties larger than the phone limit", async () => {
    try {
      await checkAvailability(RESTAURANT_ID, "2026-11-07", "19:30", 12);
      expect.fail("Should have thrown party_too_large");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BookingError);
      expect(err.code).toBe("party_too_large");
      expect(err.statusCode).toBe(422);
      expect(err.say).toContain("manager arranges");
    }
  });

  it("rejects bookings on weekly closed days (Mondays)", async () => {
    // 2026-11-09 is Monday
    try {
      await checkAvailability(RESTAURANT_ID, "2026-11-09", "19:30", 4);
      expect.fail("Should have thrown closed error for Monday");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BookingError);
      expect(err.code).toBe("closed");
      expect(err.say).toContain("closed on Mondays");
    }
  });

  it("rejects bookings on special closure dates", async () => {
    // 2026-11-10 is Tuesday, but marked as closure in seed
    try {
      await checkAvailability(RESTAURANT_ID, "2026-11-10", "19:30", 4);
      expect.fail("Should have thrown closed error for holiday");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BookingError);
      expect(err.code).toBe("closed");
      expect(err.say).toContain("closed");
    }
  });

  it("rejects bookings outside opening hours or after last seating", async () => {
    // 2026-11-07 is Saturday, open 12:00 to 23:00, last seating 21:30
    try {
      await checkAvailability(RESTAURANT_ID, "2026-11-07", "22:15", 4);
      expect.fail("Should have thrown outside_hours");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BookingError);
      expect(err.code).toBe("outside_hours");
      expect(err.say).toContain("last seating");
    }
  });

  it("rejects dates in the past", async () => {
    try {
      await checkAvailability(RESTAURANT_ID, "2020-01-01", "19:30", 2);
      expect.fail("Should have thrown in_the_past");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BookingError);
      expect(err.code).toBe("in_the_past");
      expect(err.say).toContain("already passed");
    }
  });

  it("confirms availability for valid open future slots", async () => {
    // 2026-11-07 is a Saturday
    const res = await checkAvailability(RESTAURANT_ID, "2026-11-07", "19:30", 4);
    expect(res.requested_time_available).toBe(true);
    expect(res.date).toBe("2026-11-07");
    expect(res.time).toBe("19:30");
    expect(res.party_size).toBe(4);
    expect(res.slots.length).toBe(1);
    expect(res.slots[0].start).toContain("2026-11-07T19:30:00");
    expect(res.summary).toContain("7:30 PM is available for 4");
  });

  it("correctly formats speakable times", () => {
    expect(formatShortTime("19:30")).toBe("7:30 PM");
    expect(formatShortTime("12:00")).toBe("12 PM");
    expect(formatShortTime("09:15")).toBe("9:15 AM");
    expect(formatSpeakableTime("2026-11-07", "19:30")).toBe("Saturday, November 7 at 7:30 PM");
  });
});
