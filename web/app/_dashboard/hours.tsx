"use client";

import React, { useState } from "react";
import type { Closure, DayHours, InfoEntry, SheetState } from "./types";
import { clockToMinutes, dateKey, dayLabel, minutesToLabel, titleCase, WEEKDAYS, weekdayOf } from "./format";
import { Chevron, Empty, PageHead, Section, Segmented, SkeletonRows } from "./ui";

const TOPICS = ["hours", "location", "parking", "delivery", "specials", "policies"];
const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिंदी" }
];
// Monday first, the way a restaurant reads its week.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function hoursRange(h?: DayHours) {
  const open = clockToMinutes(h?.openTime);
  const close = clockToMinutes(h?.closeTime);
  if (!h?.open || open === null || close === null) return null;
  return `${minutesToLabel(open)} – ${minutesToLabel(close)}`;
}

export function Hours({
  hours,
  closures,
  info,
  now,
  loading,
  onOpen,
  onAddClosure,
  onRemoveClosure,
  onSaveAnswer
}: {
  hours: DayHours[];
  closures: Closure[];
  info: InfoEntry[];
  now: Date;
  loading: boolean;
  onOpen: (sheet: SheetState) => void;
  onAddClosure: (closure: { date: string; reason: string }) => Promise<boolean>;
  onRemoveClosure: (id: string) => Promise<boolean>;
  onSaveAnswer: (topic: string, language: string, answer: string) => Promise<boolean>;
}) {
  const today = dateKey(now);
  const todayWeekday = weekdayOf(today);
  const [lang, setLang] = useState("en");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [newClosure, setNewClosure] = useState({ date: "", reason: "" });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const topics = [...TOPICS, ...Array.from(new Set(info.map(e => e.topic))).filter(t => !TOPICS.includes(t))];
  const sortedClosures = [...closures].sort((a, b) => a.date.localeCompare(b.date));

  async function save(topic: string) {
    if (!draft.trim()) return;
    setSaving(true);
    const ok = await onSaveAnswer(topic, lang, draft.trim());
    setSaving(false);
    if (ok) setEditing(null);
  }

  async function addClosure(e: React.FormEvent) {
    e.preventDefault();
    if (!newClosure.date || !newClosure.reason.trim()) return;
    const ok = await onAddClosure({ date: newClosure.date, reason: newClosure.reason.trim() });
    if (ok) setNewClosure({ date: "", reason: "" });
  }

  return (
    <div className="page page-narrow">
      <PageHead title="Hours & info" sub="What the receptionist tells callers about opening times, closed dates and the restaurant." />

      <Section title="Opening hours">
        {loading ? (
          <SkeletonRows count={7} />
        ) : (
          <div className="group">
            {WEEK_ORDER.map(weekday => {
              const h = hours.find(d => d.weekday === weekday);
              const range = hoursRange(h);
              const last = clockToMinutes(h?.lastSeating);
              return (
                <button key={weekday} type="button" className="row" onClick={() => onOpen({ kind: "hours", weekday })}>
                  <span className="row-main">
                    <span className="row-title" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      {WEEKDAYS[weekday]}
                      {weekday === todayWeekday && <span className="text-tint" style={{ fontSize: 12, fontWeight: 600 }}>Today</span>}
                    </span>
                    {range && last !== null && (
                      <span className="row-sub" style={{ display: "block" }}>
                        Last seating {minutesToLabel(last)}
                      </span>
                    )}
                  </span>
                  <span className="row-trail">
                    <span style={{ color: range ? "var(--label)" : "var(--label-3)" }}>{range || "Closed"}</span>
                    <Chevron />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Closed dates" foot="A closed date blocks every booking, from the phone line and from staff.">
        <div className="group">
          {sortedClosures.length === 0 && !loading && (
            <Empty title="No closed dates" body="Add holidays and private events so nobody can book those days." />
          )}
          {sortedClosures.map(c => (
            <div key={c.id || c.date} className={`row${c.date < today ? " is-past" : ""}`}>
              <span className="row-main">
                <span className="row-title" style={{ display: "block" }}>
                  {dayLabel(c.date, today)}
                </span>
                <span className="row-sub" style={{ display: "block" }}>
                  {c.reason}
                </span>
              </span>
              {confirmRemove === c.id ? (
                <span className="row-trail">
                  <button type="button" className="btn btn-quiet" onClick={() => setConfirmRemove(null)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ height: 30 }}
                    onClick={async () => {
                      await onRemoveClosure(c.id);
                      setConfirmRemove(null);
                    }}
                  >
                    Remove
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmRemove(c.id)}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <form className="row" onSubmit={addClosure} style={{ flexWrap: "wrap", gap: 8 }}>
            <label className="sr-only" htmlFor="closure-date">
              Date
            </label>
            <input
              id="closure-date"
              className="plain-input"
              type="date"
              min={today}
              value={newClosure.date}
              onChange={e => setNewClosure({ ...newClosure, date: e.target.value })}
              required
            />
            <label className="sr-only" htmlFor="closure-reason">
              Reason
            </label>
            <input
              id="closure-reason"
              className="plain-input"
              type="text"
              placeholder="Reason, e.g. Private event"
              value={newClosure.reason}
              onChange={e => setNewClosure({ ...newClosure, reason: e.target.value })}
              style={{ flex: "1 1 180px" }}
              required
            />
            <button type="submit" className="btn btn-secondary" disabled={!newClosure.date || !newClosure.reason.trim()}>
              Add date
            </button>
          </form>
        </div>
      </Section>

      <Section
        title="What the receptionist says"
        action={
          <Segmented
            label="Language"
            value={lang}
            onChange={v => {
              setLang(v);
              setEditing(null);
            }}
            options={LANGUAGES}
          />
        }
        foot="The receptionist reads these answers to callers as written."
      >
        {loading ? (
          <SkeletonRows count={4} />
        ) : (
          <div className="group">
            {topics.map(topic => {
              const entry = info.find(e => e.topic === topic && e.language === lang);
              const isEditing = editing === topic;
              return (
                <div key={topic} className="row" style={{ alignItems: "flex-start", paddingTop: 14, paddingBottom: 14 }}>
                  <span className="row-main">
                    <span className="row-sub" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                      {titleCase(topic)}
                    </span>
                    {isEditing ? (
                      <>
                        <label className="sr-only" htmlFor={`answer-${topic}`}>
                          {titleCase(topic)} answer
                        </label>
                        <textarea
                          id={`answer-${topic}`}
                          className="inline-input"
                          lang={lang}
                          value={draft}
                          autoFocus
                          onChange={e => setDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Escape") setEditing(null);
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(topic);
                          }}
                        />
                        <span style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                          <button type="button" className="btn btn-quiet" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                          <button type="button" className="btn btn-primary" disabled={saving || !draft.trim()} onClick={() => save(topic)}>
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </span>
                      </>
                    ) : entry ? (
                      <span lang={lang} style={{ display: "block", fontSize: 15, lineHeight: 1.5, maxWidth: "68ch" }}>
                        {entry.answer}
                      </span>
                    ) : (
                      <span className="text-3" style={{ display: "block", fontSize: 15 }}>
                        No answer written yet.
                      </span>
                    )}
                  </span>
                  {!isEditing && (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => {
                        setEditing(topic);
                        setDraft(entry?.answer || "");
                      }}
                    >
                      {entry ? "Edit" : "Write"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
