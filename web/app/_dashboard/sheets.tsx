"use client";

import React, { useState } from "react";
import type { Call, DayHours, Dish, Message, Reservation, Tab } from "./types";
import {
  ALLERGENS,
  clockToInput,
  clockToMinutes,
  dateKey,
  dayLabel,
  DIETARY_LABEL,
  formatDuration,
  formatPhone,
  formatTime,
  LATENCY_BUDGET_MS,
  median,
  MESSAGE_STATUS,
  OUTCOME_DOT,
  OUTCOME_LABEL,
  plural,
  relativeTime,
  RESTAURANT,
  SPICE_LEVELS,
  titleCase,
  TOPIC_LABEL,
  WEEKDAYS
} from "./format";
import { ChipToggle, Chevron, Segmented, Sheet, SheetAction, Status, Stepper, Switch } from "./ui";
import { sourceLabel } from "./reservations";
import { callTitle, LANGUAGE_NAME, LatencyBar, LatencyLegend, turnTotals } from "./calls";
import { formatPrice } from "./menu";
import { NAV } from "./nav";
import { signOut } from "../_brand/brand";

export type Frame = { closing: boolean; onRequestClose: () => void; onExited: () => void };

function Done({ frame }: { frame: Frame }) {
  return (
    <SheetAction strong onClick={frame.onRequestClose}>
      Done
    </SheetAction>
  );
}

/* ---------- Booking ---------- */

export function BookingSheet({
  frame,
  r,
  now,
  call,
  onCancel,
  onOpenCall
}: {
  frame: Frame;
  r: Reservation;
  now: Date;
  call?: Call;
  onCancel: (id: string) => Promise<boolean>;
  onOpenCall: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelled = r.status === "cancelled";
  const ended = new Date(r.end).getTime() <= now.getTime();

  return (
    <Sheet title="Booking" {...frame} trail={<Done frame={frame} />}>
      <div className="sheet-hero">
        <div className="sheet-hero-title">{r.guestName}</div>
        <div className="sheet-hero-sub">
          {dayLabel(dateKey(r.start), dateKey(now))} · {formatTime(r.start)} – {formatTime(r.end)}
        </div>
      </div>

      <div className="group">
        <div className="kv">
          <span className="kv-label">Party</span>
          <span className="kv-value">{plural(r.partySize, "guest")}</span>
        </div>
        <div className="kv">
          <span className="kv-label">Table</span>
          <span className="kv-value">{r.tableLabel || "Not assigned"}</span>
        </div>
        <div className="kv">
          <span className="kv-label">Phone</span>
          <span className="kv-value">
            <a href={`tel:${r.guestPhone}`}>{formatPhone(r.guestPhone)}</a>
          </span>
        </div>
        <div className="kv">
          <span className="kv-label">Booking code</span>
          <span className="kv-value mono" style={{ color: "var(--label)" }}>
            {r.code}
          </span>
        </div>
        <div className="kv">
          <span className="kv-label">Booked by</span>
          <span className="kv-value">{sourceLabel(r.source)}</span>
        </div>
        <div className="kv">
          <span className="kv-label">Status</span>
          <span className="kv-value">
            {cancelled ? <Status>Cancelled</Status> : ended ? <Status>Finished</Status> : <Status dot="dot-green">Confirmed</Status>}
          </span>
        </div>
      </div>

      {r.notes && (
        <div className="sheet-section">
          <div className="sheet-section-title">Notes</div>
          <div className="group">
            <p className="sheet-quote">{r.notes}</p>
          </div>
        </div>
      )}

      <div className="sheet-section">
        <div className="group">
          <a className="action-row" href={`tel:${r.guestPhone}`}>
            Call {r.guestName.split(" ")[0]}
          </a>
          {call && (
            <button type="button" className="action-row" onClick={() => onOpenCall(call.id)}>
              Show the call that made this booking
            </button>
          )}
          {!cancelled && !ended && !confirming && (
            <button type="button" className="action-row is-danger" onClick={() => setConfirming(true)}>
              Cancel booking
            </button>
          )}
          {confirming && (
            <div className="confirm-row">
              <span>Cancel this booking and free the table?</span>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)} disabled={busy}>
                Keep
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await onCancel(r.id);
                  setBusy(false);
                  if (ok) frame.onRequestClose();
                }}
              >
                {busy ? "Cancelling…" : "Cancel booking"}
              </button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- New booking ---------- */

export type NewBooking = { guest_name: string; guest_phone: string; party_size: number; date: string; time: string; notes: string };

export function NewBookingSheet({ frame, onSubmit }: { frame: Frame; onSubmit: (b: NewBooking) => Promise<string | null> }) {
  const [form, setForm] = useState<NewBooking>({
    guest_name: "",
    guest_phone: "",
    party_size: 2,
    date: dateKey(),
    time: "19:30",
    notes: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = form.guest_name.trim() && form.guest_phone.trim() && form.date && form.time;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit({ ...form, guest_name: form.guest_name.trim(), guest_phone: form.guest_phone.trim() });
    setBusy(false);
    if (err) setError(err);
    else frame.onRequestClose();
  }

  return (
    <Sheet
      title="New booking"
      {...frame}
      lead={<SheetAction onClick={frame.onRequestClose}>Cancel</SheetAction>}
      trail={
        <SheetAction strong type="submit" form="new-booking" disabled={!valid || busy}>
          {busy ? "Booking…" : "Book"}
        </SheetAction>
      }
    >
      <form id="new-booking" onSubmit={submit}>
        <div className="group">
          <div className="field">
            <label htmlFor="nb-name">Name</label>
            <input
              id="nb-name"
              required
              autoFocus
              autoComplete="off"
              placeholder="Guest name"
              value={form.guest_name}
              onChange={e => setForm({ ...form, guest_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="nb-phone">Phone</label>
            <input
              id="nb-phone"
              type="tel"
              required
              autoComplete="off"
              placeholder="+91 98765 43210"
              value={form.guest_phone}
              onChange={e => setForm({ ...form, guest_phone: e.target.value })}
            />
          </div>
          <div className="field">
            <span className="field-label">Guests</span>
            <span className="field-end" style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="num" style={{ fontSize: 15, fontWeight: 600, minWidth: 16, textAlign: "right" }} aria-live="polite">
                {form.party_size}
              </span>
              <Stepper
                label="Guests"
                value={form.party_size}
                min={1}
                max={RESTAURANT.partyLimit}
                onChange={n => setForm({ ...form, party_size: n })}
              />
            </span>
          </div>
        </div>
        <p className="form-note">Parties over {RESTAURANT.partyLimit} are booked by the manager. Take a message for them instead.</p>

        <div className="form-gap" />
        <div className="group">
          <div className="field">
            <label htmlFor="nb-date">Date</label>
            <input
              id="nb-date"
              type="date"
              required
              min={dateKey()}
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
              className="field-end"
            />
          </div>
          <div className="field">
            <label htmlFor="nb-time">Time</label>
            <input
              id="nb-time"
              type="time"
              step={900}
              required
              value={form.time}
              onChange={e => setForm({ ...form, time: e.target.value })}
              className="field-end"
            />
          </div>
        </div>
        <p className="form-note">The table is picked for you: the smallest free one that fits.</p>

        <div className="form-gap" />
        <div className="group">
          <div className="field field-stack">
            <label htmlFor="nb-notes">Notes</label>
            <textarea
              id="nb-notes"
              rows={2}
              placeholder="Window table, high chair, birthday…"
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        {error && (
          <p className="form-note is-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/* ---------- Dish ---------- */

export type DishForm = {
  name: string;
  category: string;
  price: number;
  description: string;
  dietaryTags: string[];
  spiceLevel: string;
  allergens: string[];
  allergensListed: boolean;
  availableToday: boolean;
};

export function DishSheet({
  frame,
  dish,
  categories,
  onSave,
  onDelete
}: {
  frame: Frame;
  dish?: Dish;
  categories: string[];
  onSave: (form: DishForm, id?: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const editing = Boolean(dish);
  const cats = categories.length ? categories : ["Starters", "Mains", "Breads", "Desserts & Drinks"];
  const [form, setForm] = useState<DishForm>({
    name: dish?.name || "",
    category: dish?.category || cats[0],
    price: dish?.price ?? 0,
    description: dish?.description || "",
    dietaryTags: dish?.dietaryTags || [],
    spiceLevel: dish?.spiceLevel || "none",
    allergens: dish?.allergens || [],
    allergensListed: dish?.allergensListed ?? false,
    availableToday: dish?.availableToday ?? false
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valid = form.name.trim() && form.price > 0;
  const allergenOptions = Array.from(new Set([...ALLERGENS, ...form.allergens]));

  function toggle(list: "dietaryTags" | "allergens", value: string) {
    const has = form[list].includes(value);
    setForm({ ...form, [list]: has ? form[list].filter(v => v !== value) : [...form[list], value] });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSave({ ...form, name: form.name.trim(), description: form.description.trim() }, dish?.id);
    setBusy(false);
    if (err) setError(err);
    else frame.onRequestClose();
  }

  return (
    <Sheet
      title={editing ? "Edit dish" : "New dish"}
      {...frame}
      lead={<SheetAction onClick={frame.onRequestClose}>Cancel</SheetAction>}
      trail={
        <SheetAction strong type="submit" form="dish-form" disabled={!valid || busy}>
          {busy ? "Saving…" : editing ? "Save" : "Add"}
        </SheetAction>
      }
    >
      <form id="dish-form" onSubmit={submit}>
        {editing ? (
          <div className="sheet-hero">
            <div className="sheet-hero-title">{dish!.name}</div>
            <div className="sheet-hero-sub">
              {dish!.category} · {formatPrice(dish!.price)}
            </div>
          </div>
        ) : null}

        <div className="group">
          {!editing && (
            <>
              <div className="field">
                <label htmlFor="d-name">Name</label>
                <input
                  id="d-name"
                  required
                  autoFocus
                  placeholder="Dish name"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="d-cat">Category</label>
                <select id="d-cat" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {cats.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="d-price">Price (₹)</label>
            <input
              id="d-price"
              type="number"
              inputMode="decimal"
              min={0}
              step={10}
              required
              value={form.price || ""}
              placeholder="0"
              onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="field field-stack">
            <label htmlFor="d-desc">Description</label>
            <textarea
              id="d-desc"
              rows={2}
              placeholder="What's in it, how it's cooked"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>

        <div className="sheet-section">
          <div className="sheet-section-title">Dietary</div>
          <div className="chips">
            {Object.keys(DIETARY_LABEL).map(t => (
              <ChipToggle key={t} pressed={form.dietaryTags.includes(t)} onClick={() => toggle("dietaryTags", t)}>
                {DIETARY_LABEL[t]}
              </ChipToggle>
            ))}
          </div>
        </div>

        <div className="sheet-section">
          <div className="sheet-section-title">Spice</div>
          <Segmented
            label="Spice level"
            value={form.spiceLevel}
            onChange={v => setForm({ ...form, spiceLevel: v })}
            options={SPICE_LEVELS.map(s => ({ id: s, label: titleCase(s) }))}
          />
        </div>

        <div className="sheet-section">
          <div className="sheet-section-title">Allergens</div>
          <div className="chips">
            {allergenOptions.map(a => (
              <ChipToggle key={a} pressed={form.allergens.includes(a)} onClick={() => toggle("allergens", a)}>
                {titleCase(a)}
              </ChipToggle>
            ))}
          </div>
        </div>

        <div className="sheet-section">
          <div className="group">
            <div className="field">
              <span className="field-label" style={{ width: "auto", flex: 1 }}>
                Allergens confirmed with the kitchen
              </span>
              <Switch
                label="Allergens confirmed with the kitchen"
                checked={form.allergensListed}
                onChange={v => setForm({ ...form, allergensListed: v, availableToday: v ? form.availableToday : false })}
              />
            </div>
            <div className="field">
              <span className="field-label" style={{ width: "auto", flex: 1, color: form.allergensListed ? undefined : "var(--label-3)" }}>
                On today's menu
              </span>
              <Switch
                label="On today's menu"
                checked={form.availableToday}
                disabled={!form.allergensListed}
                onChange={v => setForm({ ...form, availableToday: v })}
              />
            </div>
          </div>
          <p className="form-note">
            A dish can't go on today's menu until its allergens are confirmed. Until then the receptionist tells callers they're not listed.
          </p>
        </div>

        {error && (
          <p className="form-note is-error" role="alert">
            {error}
          </p>
        )}

        {editing && (
          <div className="sheet-section">
            <div className="group">
              {confirmDelete ? (
                <div className="confirm-row">
                  <span>Delete this dish from the menu?</span>
                  <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={async () => {
                      if (await onDelete(dish!.id)) frame.onRequestClose();
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <button type="button" className="action-row is-danger" onClick={() => setConfirmDelete(true)}>
                  Delete dish
                </button>
              )}
            </div>
          </div>
        )}
      </form>
    </Sheet>
  );
}

/* ---------- Message ---------- */

export function MessageSheet({
  frame,
  m,
  now,
  call,
  onStatus,
  onOpenCall
}: {
  frame: Frame;
  m: Message;
  now: Date;
  call?: Call;
  onStatus: (id: string, status: string) => void;
  onOpenCall: (id: string) => void;
}) {
  return (
    <Sheet title="Message" {...frame} trail={<Done frame={frame} />}>
      <div className="sheet-hero">
        <div className="sheet-hero-title">{m.callerName}</div>
        <div className="sheet-hero-sub">
          {TOPIC_LABEL[m.topic] || titleCase(m.topic)}
          {m.createdAt ? ` · ${relativeTime(m.createdAt, now)}` : ""}
        </div>
      </div>

      <div className="group">
        <p className="sheet-quote">{m.details}</p>
      </div>

      <div className="sheet-section">
        <div className="group">
          <div className="kv">
            <span className="kv-label">Phone</span>
            <span className="kv-value">
              <a href={`tel:${m.callerPhone}`}>{formatPhone(m.callerPhone)}</a>
            </span>
          </div>
          {m.createdAt && (
            <div className="kv">
              <span className="kv-label">Received</span>
              <span className="kv-value">
                {dayLabel(dateKey(m.createdAt), dateKey(now))}, {formatTime(m.createdAt)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="sheet-section">
        <div className="sheet-section-title">Status</div>
        <Segmented
          label="Message status"
          value={m.status}
          onChange={v => onStatus(m.id, v)}
          options={MESSAGE_STATUS.map(s => ({ id: s.id, label: s.label }))}
        />
      </div>

      <div className="sheet-section">
        <div className="group">
          <a className="action-row" href={`tel:${m.callerPhone}`}>
            Call {m.callerName.split(" ")[0]} back
          </a>
          {call && (
            <button type="button" className="action-row" onClick={() => onOpenCall(call.id)}>
              Show the call
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- Call ---------- */

export function CallSheet({ frame, c, now }: { frame: Frame; c: Call; now: Date }) {
  const turns = [...(c.turns || [])].sort((a, b) => a.index - b.index);
  const totals = turnTotals(turns);
  const p50 = median(totals);
  const slowest = totals.length ? Math.max(...totals) : null;
  const within = totals.filter(t => t <= LATENCY_BUDGET_MS).length;
  const models = Array.from(new Set(turns.map(t => t.latency?.llm_model).filter(Boolean)));
  const scale = Math.max(1200, slowest || 0);
  const duration = new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();

  return (
    <Sheet title="Call" {...frame} trail={<Done frame={frame} />}>
      <div className="sheet-hero">
        <div className="sheet-hero-title">{callTitle(c)}</div>
        <div className="sheet-hero-sub">
          {dayLabel(dateKey(c.startedAt), dateKey(now))}, {formatTime(c.startedAt)} · {formatDuration(duration)}
        </div>
      </div>

      <div className="group">
        <div className="kv">
          <span className="kv-label">Outcome</span>
          <span className="kv-value">
            <Status dot={OUTCOME_DOT[c.outcome]}>{OUTCOME_LABEL[c.outcome] || c.outcome}</Status>
          </span>
        </div>
        <div className="kv">
          <span className="kv-label">Channel</span>
          <span className="kv-value">{c.channel === "browser" ? "Browser" : "Phone"}</span>
        </div>
        <div className="kv">
          <span className="kv-label">Language</span>
          <span className="kv-value">{LANGUAGE_NAME[c.language] || c.language.toUpperCase()}</span>
        </div>
        {models.length > 0 && (
          <div className="kv">
            <span className="kv-label">Model</span>
            <span className="kv-value">{models.join(", ")}</span>
          </div>
        )}
      </div>

      {totals.length > 0 && (
        <div className="sheet-section">
          <div className="sheet-section-title">Response time</div>
          <div className="group">
            <div className="kv">
              <span className="kv-label">Median</span>
              <span className="kv-value">
                <strong className={(p50 ?? 0) > LATENCY_BUDGET_MS ? "text-red" : undefined}>{p50} ms</strong>
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">Slowest</span>
              <span className="kv-value">{slowest} ms</span>
            </div>
            <div className="kv">
              <span className="kv-label">Within {LATENCY_BUDGET_MS} ms</span>
              <span className="kv-value">
                {within} of {totals.length} turns
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="sheet-section">
        <div className="sheet-section-title">Transcript</div>
        {totals.length > 0 && <LatencyLegend />}
        <div className="group">
          {turns.length === 0 ? (
            <p className="sheet-quote text-2">No transcript was saved for this call.</p>
          ) : (
            turns.map((t, i) => {
              const ms = t.latency?.total_ms;
              return (
                <div key={t.id || i} className="turn">
                  <div className="turn-head">
                    <span className="turn-speaker">
                      {t.speaker === "agent" ? "Receptionist" : "Caller"}
                      {t.interrupted && <span className="turn-flag">Interrupted</span>}
                    </span>
                    {typeof ms === "number" && <span className={`turn-ms${ms > LATENCY_BUDGET_MS ? " is-over" : ""}`}>{ms} ms</span>}
                  </div>
                  <p className="turn-text">{t.text}</p>
                  {t.latency && typeof ms === "number" && <LatencyBar latency={t.latency} scale={scale} />}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- Opening hours ---------- */

export type HoursForm = { open: boolean; openTime: string; closeTime: string; lastSeating: string };

export function HoursSheet({
  frame,
  weekday,
  h,
  onSave
}: {
  frame: Frame;
  weekday: number;
  h?: DayHours;
  onSave: (weekday: number, form: HoursForm) => Promise<boolean>;
}) {
  const [form, setForm] = useState<HoursForm>({
    open: h?.open ?? false,
    openTime: clockToInput(h?.openTime) || "12:00",
    closeTime: clockToInput(h?.closeTime) || "23:00",
    lastSeating: clockToInput(h?.lastSeating) || "21:30"
  });
  const [busy, setBusy] = useState(false);
  const o = clockToMinutes(form.openTime) ?? 0;
  const c = clockToMinutes(form.closeTime) ?? 0;
  const l = clockToMinutes(form.lastSeating) ?? 0;
  const problem = !form.open
    ? null
    : c <= o
      ? "Closing time has to be after opening time."
      : l < o || l > c
        ? "Last seating has to fall between opening and closing."
        : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    const ok = await onSave(weekday, form);
    setBusy(false);
    if (ok) frame.onRequestClose();
  }

  return (
    <Sheet
      title={WEEKDAYS[weekday]}
      {...frame}
      lead={<SheetAction onClick={frame.onRequestClose}>Cancel</SheetAction>}
      trail={
        <SheetAction strong type="submit" form="hours-form" disabled={Boolean(problem) || busy}>
          {busy ? "Saving…" : "Save"}
        </SheetAction>
      }
    >
      <form id="hours-form" onSubmit={submit}>
        <div className="group">
          <div className="field">
            <span className="field-label" style={{ flex: 1 }}>
              Open
            </span>
            <Switch label={`Open on ${WEEKDAYS[weekday]}`} checked={form.open} onChange={v => setForm({ ...form, open: v })} />
          </div>
          {form.open && (
            <>
              <div className="field">
                <label htmlFor="h-open">Opens</label>
                <input id="h-open" type="time" step={900} className="field-end" value={form.openTime} onChange={e => setForm({ ...form, openTime: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="h-close">Closes</label>
                <input id="h-close" type="time" step={900} className="field-end" value={form.closeTime} onChange={e => setForm({ ...form, closeTime: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="h-last">Last seating</label>
                <input id="h-last" type="time" step={900} className="field-end" value={form.lastSeating} onChange={e => setForm({ ...form, lastSeating: e.target.value })} />
              </div>
            </>
          )}
        </div>
        <p className={`form-note${problem ? " is-error" : ""}`} role={problem ? "alert" : undefined}>
          {problem || (form.open ? "Tables are offered in 15-minute steps up to the last seating." : `Nobody can book a table on ${WEEKDAYS[weekday]}s.`)}
        </p>
      </form>
    </Sheet>
  );
}

/* ---------- More (phone) ---------- */

export function MoreSheet({ frame, onNavigate }: { frame: Frame; onNavigate: (tab: Tab) => void }) {
  const items = NAV.filter(n => !n.inTabBar);
  return (
    <Sheet title="More" {...frame} trail={<Done frame={frame} />}>
      <div className="group more-list">
        {items.map(n => {
          const Icon = n.icon;
          return (
            <button key={n.id} type="button" className="row row-has-lead" onClick={() => onNavigate(n.id)}>
              <span className="row-lead">
                <Icon size={18} />
              </span>
              <span className="row-main">
                <span className="row-title" style={{ display: "block" }}>
                  {n.label}
                </span>
              </span>
              <Chevron />
            </button>
          );
        })}
      </div>
      <div className="sheet-section">
        <div className="group">
          <button type="button" className="action-row is-danger" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </Sheet>
  );
}
