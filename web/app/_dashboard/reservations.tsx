"use client";

import React, { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Reservation, SheetState } from "./types";
import { dateKey, dayLabel, formatTime, plural } from "./format";
import { Chevron, Empty, PageHead, Section, Segmented, SkeletonRows, Status } from "./ui";

type Filter = "upcoming" | "past" | "cancelled" | "all";

export function sourceLabel(source?: string | null) {
  return source === "staff" ? "Staff" : "AI receptionist";
}

export function BookingRow({
  r,
  now,
  isNext,
  showDay,
  onOpen
}: {
  r: Reservation;
  now: Date;
  isNext?: boolean;
  showDay?: boolean;
  onOpen: (sheet: SheetState) => void;
}) {
  const startMs = new Date(r.start).getTime();
  const endMs = new Date(r.end).getTime();
  const nowMs = now.getTime();
  const cancelled = r.status === "cancelled";
  const past = !cancelled && endMs <= nowMs;
  const seated = !cancelled && startMs <= nowMs && endMs > nowMs;
  const cls = ["row", "row-has-time", isNext && "is-next", past && "is-past", cancelled && "is-muted"].filter(Boolean).join(" ");

  return (
    <button type="button" className={cls} onClick={() => onOpen({ kind: "booking", id: r.id })}>
      <span className="row-time">
        {formatTime(r.start)}
        {isNext && <span className="row-time-sub">Next</span>}
        {seated && <span className="row-time-sub" style={{ color: "var(--label-2)" }}>Now</span>}
        {showDay && !isNext && !seated && (
          <span className="row-time-sub" style={{ color: "var(--label-2)", fontWeight: 500 }}>
            {dayLabel(dateKey(r.start), dateKey(now))}
          </span>
        )}
      </span>
      <span className="row-main">
        <span className="row-title" style={{ display: "block" }}>
          {r.guestName}
        </span>
        <span className="row-sub" style={{ display: "block" }}>
          {plural(r.partySize, "guest")}
          {r.tableLabel ? ` · ${r.tableLabel}` : ""} · {sourceLabel(r.source)}
          {r.notes ? ` · ${r.notes}` : ""}
        </span>
      </span>
      <span className="row-trail">
        {cancelled && <Status>Cancelled</Status>}
        <span className="mono row-hide-sm">{r.code}</span>
        <Chevron />
      </span>
    </button>
  );
}

export function Reservations({
  reservations,
  now,
  loading,
  onOpen
}: {
  reservations: Reservation[];
  now: Date;
  loading: boolean;
  onOpen: (sheet: SheetState) => void;
}) {
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [query, setQuery] = useState("");
  const nowMs = now.getTime();
  const today = dateKey(now);

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const list = reservations
    .filter(r => {
      if (filter === "cancelled") return r.status === "cancelled";
      if (filter === "upcoming") return r.status === "confirmed" && new Date(r.end).getTime() > nowMs;
      if (filter === "past") return r.status === "confirmed" && new Date(r.end).getTime() <= nowMs;
      return true;
    })
    .filter(
      r =>
        !q ||
        r.guestName.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (digits.length >= 3 && r.guestPhone.replace(/\D/g, "").includes(digits))
    )
    .sort((a, b) => (filter === "upcoming" ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)));

  const groups: { key: string; items: Reservation[] }[] = [];
  for (const r of list) {
    const key = dateKey(r.start);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, items: [r] });
  }

  const emptyCopy: Record<Filter, { title: string; body: string }> = {
    upcoming: { title: "No upcoming bookings", body: "Bookings from the phone line and from staff appear here." },
    past: { title: "No past bookings", body: "Bookings move here once their seating time has ended." },
    cancelled: { title: "No cancelled bookings", body: "Bookings cancelled by a caller or by staff appear here." },
    all: { title: "No bookings yet", body: "Bookings from the phone line and from staff appear here." }
  };

  return (
    <div className="page">
      <PageHead
        title="Reservations"
        sub="Every booking, from the phone line and from staff."
        action={
          <button type="button" className="btn btn-primary" onClick={() => onOpen({ kind: "new-booking" })}>
            <Plus size={16} strokeWidth={2.4} /> New booking
          </button>
        }
      />

      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search bookings</span>
          <input
            type="search"
            placeholder="Name, phone or booking code"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "upcoming", label: "Upcoming" },
            { id: "past", label: "Past" },
            { id: "cancelled", label: "Cancelled" },
            { id: "all", label: "All" }
          ]}
        />
      </div>

      {loading ? (
        <SkeletonRows count={5} />
      ) : groups.length === 0 ? (
        <div className="group">
          {q ? <Empty title="No matches" body={`No bookings match "${query.trim()}".`} /> : <Empty {...emptyCopy[filter]} />}
        </div>
      ) : (
        groups.map(g => {
          const live = g.items.filter(r => r.status === "confirmed");
          const guests = live.reduce((s, r) => s + r.partySize, 0);
          return (
            <Section
              key={g.key}
              title={dayLabel(g.key, today)}
              meta={live.length ? `${plural(live.length, "booking")} · ${plural(guests, "guest")}` : plural(g.items.length, "booking")}
            >
              <div className="group">
                {g.items.map(r => (
                  <BookingRow key={r.id} r={r} now={now} onOpen={onOpen} />
                ))}
              </div>
            </Section>
          );
        })
      )}
    </div>
  );
}
