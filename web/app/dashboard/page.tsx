"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, LogOut, RotateCcw } from "lucide-react";
import type { DashboardData, Dish, Message, SheetState, Tab } from "../_dashboard/types";
import { formatPhone, formatTime, RESTAURANT } from "../_dashboard/format";
import { NAV, TAB_IDS } from "../_dashboard/nav";
import { Toast } from "../_dashboard/ui";
import { Tonight } from "../_dashboard/tonight";
import { Reservations } from "../_dashboard/reservations";
import { Messages } from "../_dashboard/messages";
import { Calls } from "../_dashboard/calls";
import { Menu, dishCategories } from "../_dashboard/menu";
import { Hours } from "../_dashboard/hours";
import { BRAND, signOut } from "../_brand/brand";
import { ThemeSwitch } from "../_brand/theme-switch";
import { Insights } from "../_dashboard/insights";
import { useDashboardMotion } from "../_dashboard/motion";
import { SEATING_MINUTES, bookingCode, freeTable, sampleDashboard } from "../_dashboard/sample-data";
import {
  BookingSheet,
  CallSheet,
  DishSheet,
  HoursSheet,
  MessageSheet,
  MoreSheet,
  NewBookingSheet,
  type DishForm,
  type Frame,
  type HoursForm,
  type NewBooking
} from "../_dashboard/sheets";

const EMPTY: DashboardData = { reservations: [], tables: [], menu: [], hours: [], closures: [], info: [], calls: [], messages: [] };

// The dashboard is a public demo: it runs on sample data and never reads or writes the database.
// Changes a visitor makes live in this tab until they reset or reload.

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("tonight");
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "error"; id: number } | null>(null);

  const appRef = useRef<HTMLDivElement>(null);
  useDashboardMotion(appRef, tab);

  /* ---------- Data ---------- */

  // Built in the browser, after the first paint, so the sample times match the visitor's clock
  // and the server render (skeletons) matches the first client render.
  const reset = useCallback(() => {
    const at = new Date();
    setNow(at);
    setData(sampleDashboard(at));
    setLoading(false);
  }, []);

  useEffect(() => {
    reset();
    const clock = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(clock);
  }, [reset]);

  /* ---------- Navigation (kept in the URL hash so refresh and back work) ---------- */

  useEffect(() => {
    function fromHash() {
      const id = window.location.hash.replace("#", "") as Tab;
      if (TAB_IDS.includes(id)) setTab(id);
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    const label = NAV.find(n => n.id === tab)?.label;
    document.title = `${label} · ${RESTAURANT.name} · ${BRAND.name}`;
  }, [tab]);

  function navigate(next: Tab) {
    if (sheet?.kind === "more") closeSheet();
    if (next === tab) return;
    setTab(next);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, "", `#${next}`);
    window.scrollTo({ top: 0 });
  }

  /* ---------- Sheets and toasts ---------- */

  function openSheet(next: SheetState) {
    setSheetClosing(false);
    setSheet(next);
  }

  function closeSheet() {
    setSheetClosing(true);
  }

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(message: string, tone: "ok" | "error" = "ok") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, tone, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 4200 : 2600);
  }

  /* ---------- Reservations ---------- */

  // The same rules the booking API enforces, checked here against the sample data.
  async function handleAddReservation(b: NewBooking): Promise<string | null> {
    const startIso = `${b.date}T${b.time}:00${RESTAURANT.offset}`;
    const start = new Date(startIso);
    if (b.party_size > RESTAURANT.partyLimit) return `Parties over ${RESTAURANT.partyLimit} are arranged by the manager.`;
    if (start.getTime() < Date.now()) return "That time has already passed. Pick a later time.";
    const day = data.hours.find(h => h.weekday === new Date(`${b.date}T12:00:00${RESTAURANT.offset}`).getUTCDay());
    const closure = data.closures.find(c => c.date === b.date);
    if (closure || !day?.open) return closure ? `We're closed that day: ${closure.reason}.` : "We're closed that day.";
    const opens = (day.openTime ?? "00:00").slice(0, 5);
    const last = (day.lastSeating ?? day.closeTime ?? "23:59").slice(0, 5);
    if (b.time < opens || b.time > last) return `Bookings run from ${opens} to the last seating at ${last}.`;
    const table = freeTable(data, startIso, b.party_size);
    if (!table) return "No table that size is free then. Try another time.";
    const code = bookingCode(new Set(data.reservations.map(r => r.code)));
    setData(d => ({
      ...d,
      reservations: [
        ...d.reservations,
        {
          id: `local-booking-${Date.now()}`,
          tableId: table.id,
          tableLabel: table.label,
          guestName: b.guest_name,
          guestPhone: b.guest_phone,
          partySize: b.party_size,
          start: start.toISOString(),
          end: new Date(start.getTime() + SEATING_MINUTES * 60_000).toISOString(),
          status: "confirmed",
          code,
          notes: b.notes || null,
          source: "staff",
          callId: null
        }
      ]
    }));
    notify(`Booked ${b.guest_name}, ${formatTime(startIso)} · ${code}`);
    return null;
  }

  async function handleCancelReservation(id: string) {
    setData(d => ({ ...d, reservations: d.reservations.map(r => (r.id === id ? { ...r, status: "cancelled" } : r)) }));
    notify("Booking cancelled. The table is free.");
    return true;
  }

  /* ---------- Menu ---------- */

  async function handleToggleDishAvailability(dish: Dish) {
    if (!dish.availableToday && !dish.allergensListed) {
      notify("Confirm this dish's allergens before putting it on today's menu.", "error");
      return;
    }
    setData(d => ({ ...d, menu: d.menu.map(m => (m.id === dish.id ? { ...m, availableToday: !dish.availableToday } : m)) }));
  }

  async function handleSaveDish(form: DishForm, id?: string): Promise<string | null> {
    if (form.availableToday && !form.allergensListed) {
      return "Confirm the allergens before putting the dish on today's menu.";
    }
    const fields = {
      price: form.price,
      description: form.description,
      dietaryTags: form.dietaryTags,
      spiceLevel: form.spiceLevel,
      allergens: form.allergens,
      allergensListed: form.allergensListed,
      availableToday: form.availableToday
    };
    setData(d => ({
      ...d,
      menu: id
        ? d.menu.map(m => (m.id === id ? { ...m, ...fields } : m))
        : [...d.menu, { id: `local-dish-${Date.now()}`, name: form.name, category: form.category, ...fields }]
    }));
    notify(id ? "Dish saved" : `${form.name} added to the menu`);
    return null;
  }

  async function handleDeleteDish(id: string) {
    setData(d => ({ ...d, menu: d.menu.filter(m => m.id !== id) }));
    notify("Dish deleted");
    return true;
  }

  /* ---------- Messages ---------- */

  async function handleUpdateMessageStatus(id: string, newStatus: string) {
    setData(d => ({ ...d, messages: d.messages.map(m => (m.id === id ? { ...m, status: newStatus } : m)) }));
  }

  /* ---------- Hours and info ---------- */

  async function handleAddClosure(closure: { date: string; reason: string }) {
    if (data.closures.some(c => c.date === closure.date)) {
      notify("That date is already closed.", "error");
      return false;
    }
    setData(d => ({ ...d, closures: [...d.closures, { id: `local-closure-${Date.now()}`, ...closure }] }));
    notify("Closed date added");
    return true;
  }

  async function handleRemoveClosure(closureId: string) {
    setData(d => ({ ...d, closures: d.closures.filter(c => c.id !== closureId) }));
    notify("Closed date removed");
    return true;
  }

  async function handleSaveHours(weekday: number, form: HoursForm) {
    const body = {
      weekday,
      open: form.open,
      openTime: form.open ? form.openTime : null,
      closeTime: form.open ? form.closeTime : null,
      lastSeating: form.open ? form.lastSeating : null
    };
    setData(d => ({
      ...d,
      hours: d.hours.some(h => h.weekday === weekday) ? d.hours.map(h => (h.weekday === weekday ? { ...h, ...body } : h)) : [...d.hours, body]
    }));
    notify("Opening hours saved");
    return true;
  }

  async function handleSaveInfoAnswer(topic: string, language: string, answer: string) {
    setData(d => {
      const exists = d.info.some(e => e.topic === topic && e.language === language);
      return {
        ...d,
        info: exists
          ? d.info.map(e => (e.topic === topic && e.language === language ? { ...e, answer } : e))
          : [...d.info, { topic, language, answer }]
      };
    });
    notify("Answer saved");
    return true;
  }

  /* ---------- Render ---------- */

  const newMessages = data.messages.filter(m => m.status === "new").length;
  const findCall = (callId?: string | null) => (callId ? data.calls.find(c => c.callId === callId) : undefined);

  let screen: React.ReactNode;
  switch (tab) {
    case "tonight":
      screen = <Tonight data={data} now={now} loading={loading} onOpen={openSheet} onNavigate={navigate} />;
      break;
    case "reservations":
      screen = <Reservations reservations={data.reservations} now={now} loading={loading} onOpen={openSheet} />;
      break;
    case "messages":
      screen = <Messages messages={data.messages} now={now} loading={loading} onOpen={openSheet} />;
      break;
    case "calls":
      screen = <Calls calls={data.calls} now={now} loading={loading} onOpen={openSheet} />;
      break;
    case "menu":
      screen = <Menu menu={data.menu} loading={loading} onOpen={openSheet} onToggle={handleToggleDishAvailability} />;
      break;
    case "hours":
      screen = (
        <Hours
          hours={data.hours}
          closures={data.closures}
          info={data.info}
          now={now}
          loading={loading}
          onOpen={openSheet}
          onAddClosure={handleAddClosure}
          onRemoveClosure={handleRemoveClosure}
          onSaveAnswer={handleSaveInfoAnswer}
        />
      );
      break;
    case "insights":
      screen = <Insights calls={data.calls} menu={data.menu} loading={loading} now={now} />;
      break;
  }

  const frame: Frame = {
    closing: sheetClosing,
    onRequestClose: closeSheet,
    onExited: () => {
      setSheet(null);
      setSheetClosing(false);
    }
  };

  let sheetView: React.ReactNode = null;
  if (sheet) {
    const key = JSON.stringify(sheet);
    switch (sheet.kind) {
      case "booking": {
        const r = data.reservations.find(x => x.id === sheet.id);
        if (r)
          sheetView = (
            <BookingSheet
              key={key}
              frame={frame}
              r={r}
              now={now}
              call={findCall(r.callId)}
              onCancel={handleCancelReservation}
              onOpenCall={id => openSheet({ kind: "call", id })}
            />
          );
        break;
      }
      case "new-booking":
        sheetView = <NewBookingSheet key={key} frame={frame} onSubmit={handleAddReservation} />;
        break;
      case "dish": {
        const dish = sheet.id ? data.menu.find(d => d.id === sheet.id) : undefined;
        if (!sheet.id || dish)
          sheetView = (
            <DishSheet
              key={key}
              frame={frame}
              dish={dish}
              categories={dishCategories(data.menu)}
              onSave={handleSaveDish}
              onDelete={handleDeleteDish}
            />
          );
        break;
      }
      case "message": {
        const m = data.messages.find((x: Message) => x.id === sheet.id);
        if (m)
          sheetView = (
            <MessageSheet
              key={key}
              frame={frame}
              m={m}
              now={now}
              call={findCall(m.callId)}
              onStatus={handleUpdateMessageStatus}
              onOpenCall={id => openSheet({ kind: "call", id })}
            />
          );
        break;
      }
      case "call": {
        const c = data.calls.find(x => x.id === sheet.id);
        if (c) sheetView = <CallSheet key={key} frame={frame} c={c} now={now} />;
        break;
      }
      case "hours":
        sheetView = (
          <HoursSheet key={key} frame={frame} weekday={sheet.weekday} h={data.hours.find(h => h.weekday === sheet.weekday)} onSave={handleSaveHours} />
        );
        break;
      case "more":
        sheetView = <MoreSheet key={key} frame={frame} onNavigate={navigate} />;
        break;
    }
  }

  const groups = ["Service", "Restaurant", "Receptionist"] as const;
  const clock = (
    <span suppressHydrationWarning className="clock-time">
      {formatTime(now)}
    </span>
  );
  const refreshButton = (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        reset();
        notify("Sample data reset");
      }}
      aria-label="Reset sample data"
      title="Reset sample data"
    >
      <RotateCcw size={16} />
    </button>
  );
  const workspace = (
    <div className="workspace">
      <span className="workspace-mark" aria-hidden="true">
        {RESTAURANT.initials}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="workspace-name" style={{ display: "block" }}>
          {RESTAURANT.name}
        </span>
        <span className="workspace-sub num" style={{ display: "block" }}>
          {formatPhone(RESTAURANT.phone)}
        </span>
      </span>
    </div>
  );
  const moreActive = !NAV.find(n => n.id === tab)?.inTabBar;

  return (
    <div className="app" ref={appRef}>
      <aside className="sidebar" aria-label="Sections">
        {workspace}
        <nav>
          <span className="nav-selection" aria-hidden="true" />
          {groups.map(group => (
            <div key={group} className="nav-group">
              <div className="nav-group-label">{group}</div>
              {NAV.filter(n => n.group === group).map(n => {
                const Icon = n.icon;
                return (
                  <a
                    key={n.id}
                    href={`#${n.id}`}
                    className="nav-item"
                    aria-current={tab === n.id ? "page" : undefined}
                    onClick={e => {
                      e.preventDefault();
                      navigate(n.id);
                    }}
                  >
                    <Icon size={17} />
                    {n.label}
                    {n.id === "messages" && newMessages > 0 && <span className="nav-count">{newMessages}</span>}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            <div className="clock-label">{RESTAURANT.city} time</div>
            {clock}
          </div>
          <span style={{ display: "flex", alignItems: "center" }}>
            <ThemeSwitch className="theme-switch-sm" />
            {refreshButton}
            <button type="button" className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="mobile-bar">
          {workspace}
          <div className="mobile-bar-trail">
            {clock}
            <ThemeSwitch className="theme-switch-sm" />
            {refreshButton}
          </div>
        </header>

        <main>{screen}</main>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {NAV.filter(n => n.inTabBar).map(n => {
          const Icon = n.icon;
          return (
            <a
              key={n.id}
              href={`#${n.id}`}
              className="tab"
              aria-current={tab === n.id ? "page" : undefined}
              onClick={e => {
                e.preventDefault();
                navigate(n.id);
              }}
            >
              <Icon size={22} strokeWidth={tab === n.id ? 2.2 : 1.8} />
              {n.short}
              {n.id === "messages" && newMessages > 0 && <span className="tab-badge">{newMessages}</span>}
            </a>
          );
        })}
        <button type="button" className="tab" aria-current={moreActive ? "page" : undefined} onClick={() => openSheet({ kind: "more" })}>
          <Ellipsis size={22} strokeWidth={moreActive ? 2.2 : 1.8} />
          More
        </button>
      </nav>

      {sheetView}
      {toast && <Toast key={toast.id} message={toast.message} tone={toast.tone} />}
    </div>
  );
}
