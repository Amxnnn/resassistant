"use client";

import React from "react";
import { CircleAlert, Plus } from "lucide-react";
import type { DashboardData, Reservation, SheetState, Tab } from "./types";
import {
  clockToMinutes,
  dateKey,
  formatTime,
  longDay,
  minutesOfDay,
  minutesToLabel,
  plural,
  relativeTime,
  TOPIC_LABEL,
  weekdayOf
} from "./format";
import { Chevron, Empty, PageHead, Section, SkeletonRows } from "./ui";
import { BookingRow } from "./reservations";

export function Tonight({
  data,
  now,
  loading,
  onOpen,
  onNavigate
}: {
  data: DashboardData;
  now: Date;
  loading: boolean;
  onOpen: (sheet: SheetState) => void;
  onNavigate: (tab: Tab) => void;
}) {
  const today = dateKey(now);
  const nowMs = now.getTime();
  const confirmed = data.reservations.filter(r => r.status === "confirmed");
  const tonight = confirmed
    .filter(r => dateKey(r.start) === today)
    .sort((a, b) => a.start.localeCompare(b.start));
  const next = tonight.find(r => new Date(r.start).getTime() >= nowMs);
  const guests = tonight.reduce((sum, r) => sum + r.partySize, 0);
  const upcoming = confirmed
    .filter(r => dateKey(r.start) > today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3);

  const hours = data.hours.find(h => h.weekday === weekdayOf(today));
  const closure = data.closures.find(c => c.date === today);
  const closedToday = Boolean(closure) || (hours ? !hours.open : false);

  const newMessages = data.messages
    .filter(m => m.status === "new")
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const missingAllergens = data.menu.filter(d => !d.allergensListed);

  let sub: React.ReactNode;
  if (loading) {
    sub = longDay(today);
  } else if (closedToday) {
    sub = (
      <>
        {longDay(today)} · <strong>Closed today</strong>
        {closure ? ` (${closure.reason})` : ""}
      </>
    );
  } else {
    sub = (
      <>
        {longDay(today)} · {plural(tonight.length, "booking")} · {plural(guests, "guest")}
        {next && (
          <>
            {" · "}
            <span className="is-next">
              next at {formatTime(next.start)}, {next.guestName}
            </span>
          </>
        )}
      </>
    );
  }

  return (
    <div className="page">
      <PageHead
        title="Tonight"
        sub={sub}
        action={
          <button type="button" className="btn btn-primary" onClick={() => onOpen({ kind: "new-booking" })}>
            <Plus size={16} strokeWidth={2.4} /> New booking
          </button>
        }
      />

      {!closedToday && (
        <Floor data={data} tonight={tonight} next={next} now={now} loading={loading} onOpen={onOpen} />
      )}

      <div className="columns section">
        <Section title="Bookings" meta={!loading && tonight.length > 0 ? plural(tonight.length, "table") : undefined}>
          {loading ? (
            <SkeletonRows count={3} />
          ) : tonight.length === 0 ? (
            <div className="group">
              <Empty
                title={closedToday ? "Closed today" : "No bookings tonight"}
                body={
                  closedToday
                    ? "The receptionist won't take bookings for today."
                    : "Bookings for today appear here as soon as the receptionist or a staff member takes them."
                }
              />
              {upcoming.length > 0 && (
                <>
                  <div className="row" style={{ minHeight: 36, paddingTop: 14, paddingBottom: 4 }}>
                    <span className="section-meta">Coming up</span>
                  </div>
                  {upcoming.map(r => (
                    <BookingRow key={r.id} r={r} now={now} showDay onOpen={onOpen} />
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="group">
              {tonight.map(r => (
                <BookingRow key={r.id} r={r} now={now} isNext={r.id === next?.id} onOpen={onOpen} />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Needs you"
          action={
            newMessages.length > 4 ? (
              <button type="button" className="btn btn-quiet" onClick={() => onNavigate("messages")}>
                All {newMessages.length}
              </button>
            ) : undefined
          }
        >
          {loading ? (
            <SkeletonRows count={2} />
          ) : newMessages.length === 0 && missingAllergens.length === 0 ? (
            <div className="group">
              <Empty
                title="Nothing needs you"
                body="New messages for the manager and dishes missing allergen details show up here."
              />
            </div>
          ) : (
            <div className="group">
              {missingAllergens.length > 0 && (
                <button type="button" className="row row-has-lead" onClick={() => onNavigate("menu")}>
                  <span className="row-lead text-red">
                    <CircleAlert size={18} />
                  </span>
                  <span className="row-main">
                    <span className="row-title" style={{ display: "block" }}>
                      {plural(missingAllergens.length, "dish", "dishes")} missing allergens
                    </span>
                    <span className="row-sub" style={{ display: "block" }}>
                      Can't go on today's menu until confirmed
                    </span>
                  </span>
                  <Chevron />
                </button>
              )}
              {newMessages.slice(0, 4).map(m => (
                <button key={m.id} type="button" className="row row-has-lead" onClick={() => onOpen({ kind: "message", id: m.id })}>
                  <span className="row-lead">
                    <span className="unread-dot" aria-label="New" />
                  </span>
                  <span className="row-main">
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span className="row-title">{m.callerName}</span>
                      <span className="row-trail">{relativeTime(m.createdAt, now)}</span>
                    </span>
                    <span className="row-sub" style={{ display: "block" }}>
                      {TOPIC_LABEL[m.topic] || m.topic}
                    </span>
                    <span className="row-body">{m.details}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/* Tables down the side, time across, every booking drawn to its real seating length. */
function Floor({
  data,
  tonight,
  next,
  now,
  loading,
  onOpen
}: {
  data: DashboardData;
  tonight: Reservation[];
  next?: Reservation;
  now: Date;
  loading: boolean;
  onOpen: (sheet: SheetState) => void;
}) {
  const today = dateKey(now);
  const hours = data.hours.find(h => h.weekday === weekdayOf(today));
  const opens = clockToMinutes(hours?.openTime);
  const closes = clockToMinutes(hours?.closeTime);

  const starts = tonight.map(r => minutesOfDay(r.start));
  const ends = tonight.map(r => minutesOfDay(r.start) + (new Date(r.end).getTime() - new Date(r.start).getTime()) / 60_000);
  const from = Math.floor(Math.min(opens ?? 720, ...starts) / 60) * 60;
  const to = Math.ceil(Math.max(closes ?? 1380, ...ends) / 60) * 60;
  const span = Math.max(60, to - from);
  const pct = (mins: number) => `${((mins - from) / span) * 100}%`;

  const nowMins = minutesOfDay(now);
  const nowInRange = nowMins >= from && nowMins <= to;

  const tables = data.tables.length
    ? data.tables
    : Array.from(new Set(tonight.map(r => r.tableLabel).filter(Boolean))).map(label => ({ id: String(label), label: String(label), capacity: 0 }));

  const nowMs = now.getTime();
  const freeNow = tables.filter(
    t => !tonight.some(r => sameTable(r, t) && new Date(r.start).getTime() <= nowMs && new Date(r.end).getTime() > nowMs)
  ).length;

  const hourMarks: number[] = [];
  for (let m = from; m <= to; m += 60) hourMarks.push(m);

  const lastSeating = clockToMinutes(hours?.lastSeating);
  const meta = loading
    ? undefined
    : [
        nowInRange && nowMins >= (opens ?? from) && nowMins < (closes ?? to) ? `${freeNow} of ${tables.length} free now` : null,
        lastSeating !== null ? `last seating ${minutesToLabel(lastSeating)}` : null
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <Section title="Tables" meta={meta || undefined}>
      <div className="group">
        {loading ? (
          <div style={{ padding: 16 }}>
            <span className="skeleton" style={{ height: 120 }} />
          </div>
        ) : tables.length === 0 ? (
          <Empty title="No tables set up" body="Add tables to the restaurant to see tonight's floor." />
        ) : (
          <div className="floor">
            <div className="floor-grid">
              <div />
              <div className="floor-axis" aria-hidden="true">
                {hourMarks.map(m => (
                  <span key={m} className="floor-tick-label" style={{ left: pct(m) }}>
                    {minutesToLabel(m, true)}
                  </span>
                ))}
                {nowInRange && (
                  <span className="floor-now-label" style={{ left: pct(nowMins) }}>
                    {formatTime(now)}
                  </span>
                )}
              </div>

              {tables.map(t => {
                const bookings = tonight.filter(r => sameTable(r, t));
                return (
                  <React.Fragment key={t.id}>
                    <div className="floor-label">
                      <b>{t.label}</b>
                      {t.capacity > 0 && <span>{t.capacity} seats</span>}
                    </div>
                    <div className="floor-track">
                      {hourMarks.map(m => (
                        <span key={m} className="floor-hour" style={{ left: pct(m) }} aria-hidden="true" />
                      ))}
                      {nowInRange && <span className="floor-past" style={{ width: pct(nowMins) }} aria-hidden="true" />}
                      {nowInRange && <span className="floor-now" style={{ left: pct(nowMins) }} aria-hidden="true" />}
                      {bookings.map(r => {
                        const s = minutesOfDay(r.start);
                        const len = (new Date(r.end).getTime() - new Date(r.start).getTime()) / 60_000;
                        const past = new Date(r.end).getTime() <= nowMs;
                        const isNext = r.id === next?.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className={`floor-booking${isNext ? " is-next" : past ? " is-past" : ""}`}
                            style={{ left: pct(s), width: `${(len / span) * 100}%` }}
                            onClick={() => onOpen({ kind: "booking", id: r.id })}
                            aria-label={`${t.label}: ${r.guestName}, ${r.partySize} guests, ${formatTime(r.start)} to ${formatTime(r.end)}`}
                            title={`${r.guestName} · ${r.partySize} · ${formatTime(r.start)}–${formatTime(r.end)}`}
                          >
                            <span>{r.guestName}</span>
                            <em>{r.partySize}</em>
                          </button>
                        );
                      })}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function sameTable(r: Reservation, t: { id: string; label: string }) {
  return r.tableId ? r.tableId === t.id || r.tableLabel === t.label : r.tableLabel === t.label;
}
