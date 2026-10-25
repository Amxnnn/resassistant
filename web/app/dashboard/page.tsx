"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Ellipsis, LogOut, RefreshCw } from "lucide-react";
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
import { TestCall } from "../_dashboard/test-call";
import { useLiveCall } from "../_brand/use-live-call";
import { BRAND, signOut } from "../_brand/brand";
import { Insights } from "../_dashboard/insights";
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

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function send(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  const error = typeof data?.error === "string" ? data.error : data?.error?.say || data?.error?.message;
  return { ok: res.ok, data, error: error as string | undefined };
}

function friendlyBookingError(message?: string) {
  if (!message) return "Couldn't save the booking. Try again.";
  if (/excl|overlap|conflict/i.test(message)) return "That table is already booked at that time. Try another time.";
  return message;
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("tonight");
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "error"; id: number } | null>(null);

  // The agent saves the call log when the call closes; give it a moment, then refresh Calls.
  const testCall = useLiveCall({ callerName: "Staff test call", onEnded: () => setTimeout(() => load(true), 4000) });

  const restaurantId = RESTAURANT.id;

  /* ---------- Data ---------- */

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    const results = await Promise.allSettled([
      getJson("/api/dashboard/reservations"),
      getJson("/api/dashboard/tables"),
      getJson("/api/dashboard/menu"),
      getJson("/api/dashboard/hours"),
      getJson("/api/dashboard/info"),
      getJson("/api/dashboard/calls"),
      getJson("/api/dashboard/messages")
    ]);
    const [rRes, tRes, mRes, hRes, iRes, cRes, msgRes] = results.map(r => (r.status === "fulfilled" ? r.value : null));
    setData(prev => ({
      reservations: rRes?.reservations ?? prev.reservations,
      tables: tRes?.tables ?? prev.tables,
      menu: mRes?.items ?? prev.menu,
      hours: hRes?.hours ?? prev.hours,
      closures: hRes?.closures ?? prev.closures,
      info: iRes?.entries ?? prev.info,
      calls: cRes?.calls ?? prev.calls,
      messages: msgRes?.messages ?? prev.messages
    }));
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length) console.error("Dashboard load failed:", failed);
    setLoadError(failed.length > 0);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    const clock = setInterval(() => setNow(new Date()), 15_000);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, 60_000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [load]);

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

  async function handleAddReservation(b: NewBooking): Promise<string | null> {
    try {
      const startIso = `${b.date}T${b.time}:00${RESTAURANT.offset}`;
      const res = await send("/api/dashboard/reservations", "POST", {
        restaurant_id: restaurantId,
        guest_name: b.guest_name,
        guest_phone: b.guest_phone,
        party_size: b.party_size,
        start: startIso,
        notes: b.notes
      });
      if (!res.ok) return friendlyBookingError(res.error);
      notify(`Booked ${b.guest_name}, ${formatTime(startIso)}${res.data?.code ? ` · ${res.data.code}` : ""}`);
      load(true);
      return null;
    } catch {
      return "Couldn't reach the server. Check the connection and try again.";
    }
  }

  async function handleCancelReservation(id: string) {
    try {
      const res = await send("/api/dashboard/reservations", "PATCH", { id, status: "cancelled" });
      if (!res.ok) {
        notify(res.error || "Couldn't cancel the booking.", "error");
        return false;
      }
      setData(d => ({ ...d, reservations: d.reservations.map(r => (r.id === id ? { ...r, status: "cancelled" } : r)) }));
      notify("Booking cancelled. The table is free.");
      return true;
    } catch {
      notify("Couldn't cancel the booking.", "error");
      return false;
    }
  }

  /* ---------- Menu ---------- */

  async function handleToggleDishAvailability(dish: Dish) {
    if (!dish.availableToday && !dish.allergensListed) {
      notify("Confirm this dish's allergens before putting it on today's menu.", "error");
      return;
    }
    const next = !dish.availableToday;
    setData(d => ({ ...d, menu: d.menu.map(m => (m.id === dish.id ? { ...m, availableToday: next } : m)) }));
    try {
      const res = await send("/api/dashboard/menu", "PATCH", { id: dish.id, availableToday: next });
      if (!res.ok) throw new Error(res.error);
    } catch (err: any) {
      setData(d => ({ ...d, menu: d.menu.map(m => (m.id === dish.id ? { ...m, availableToday: !next } : m)) }));
      notify(err?.message || "Couldn't update the dish.", "error");
    }
  }

  async function handleSaveDish(form: DishForm, id?: string): Promise<string | null> {
    if (form.availableToday && !form.allergensListed) {
      return "Confirm the allergens before putting the dish on today's menu.";
    }
    try {
      const res = id
        ? await send("/api/dashboard/menu", "PATCH", {
            id,
            price: form.price,
            description: form.description,
            dietaryTags: form.dietaryTags,
            spiceLevel: form.spiceLevel,
            allergens: form.allergens,
            allergensListed: form.allergensListed,
            availableToday: form.availableToday
          })
        : await send("/api/dashboard/menu", "POST", form);
      if (!res.ok) return res.error || "Couldn't save the dish.";
      notify(id ? "Dish saved" : `${form.name} added to the menu`);
      load(true);
      return null;
    } catch {
      return "Couldn't reach the server. Check the connection and try again.";
    }
  }

  async function handleDeleteDish(id: string) {
    try {
      const res = await send(`/api/dashboard/menu?id=${encodeURIComponent(id)}`, "DELETE");
      if (!res.ok) throw new Error(res.error);
      setData(d => ({ ...d, menu: d.menu.filter(m => m.id !== id) }));
      notify("Dish deleted");
      return true;
    } catch (err: any) {
      notify(err?.message || "Couldn't delete the dish.", "error");
      return false;
    }
  }

  /* ---------- Messages ---------- */

  async function handleUpdateMessageStatus(id: string, newStatus: string) {
    const prev = data.messages.find(m => m.id === id)?.status;
    setData(d => ({ ...d, messages: d.messages.map(m => (m.id === id ? { ...m, status: newStatus } : m)) }));
    try {
      const res = await send("/api/dashboard/messages", "PATCH", { id, status: newStatus });
      if (!res.ok) throw new Error(res.error);
    } catch (err: any) {
      setData(d => ({ ...d, messages: d.messages.map(m => (m.id === id && prev ? { ...m, status: prev } : m)) }));
      notify(err?.message || "Couldn't update the message.", "error");
    }
  }

  /* ---------- Hours and info ---------- */

  async function handleAddClosure(closure: { date: string; reason: string }) {
    try {
      const res = await send("/api/dashboard/hours", "PATCH", { addClosure: closure });
      if (!res.ok) throw new Error(res.error);
      notify("Closed date added");
      load(true);
      return true;
    } catch (err: any) {
      notify(err?.message || "Couldn't add the closed date.", "error");
      return false;
    }
  }

  async function handleRemoveClosure(closureId: string) {
    try {
      const res = await send("/api/dashboard/hours", "PATCH", { removeClosureId: closureId });
      if (!res.ok) throw new Error(res.error);
      setData(d => ({ ...d, closures: d.closures.filter(c => c.id !== closureId) }));
      notify("Closed date removed");
      return true;
    } catch (err: any) {
      notify(err?.message || "Couldn't remove the closed date.", "error");
      return false;
    }
  }

  async function handleSaveHours(weekday: number, form: HoursForm) {
    const body = {
      weekday,
      open: form.open,
      openTime: form.open ? form.openTime : null,
      closeTime: form.open ? form.closeTime : null,
      lastSeating: form.open ? form.lastSeating : null
    };
    try {
      const res = await send("/api/dashboard/hours", "PATCH", body);
      if (!res.ok) throw new Error(res.error);
      setData(d => ({
        ...d,
        hours: d.hours.some(h => h.weekday === weekday)
          ? d.hours.map(h => (h.weekday === weekday ? { ...h, ...body } : h))
          : [...d.hours, body]
      }));
      notify("Opening hours saved");
      return true;
    } catch (err: any) {
      notify(err?.message || "Couldn't save the hours.", "error");
      return false;
    }
  }

  async function handleSaveInfoAnswer(topic: string, language: string, answer: string) {
    try {
      const res = await send("/api/dashboard/info", "PATCH", { topic, language, answer });
      if (!res.ok) throw new Error(res.error);
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
    } catch (err: any) {
      notify(err?.message || "Couldn't save the answer.", "error");
      return false;
    }
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
    case "test-call":
      screen = <TestCall call={testCall} />;
      break;
    case "insights":
      screen = <Insights calls={data.calls} menu={data.menu} loading={loading} />;
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
      className={`icon-btn${refreshing ? " is-spinning" : ""}`}
      onClick={() => load(true)}
      aria-label="Refresh"
      title="Refresh"
      disabled={refreshing}
    >
      <RefreshCw size={16} />
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
    <div className="app">
      <aside className="sidebar" aria-label="Sections">
        {workspace}
        <nav>
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
          <span style={{ display: "flex" }}>
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
            {refreshButton}
          </div>
        </header>

        {loadError && (
          <div className="page" style={{ paddingBottom: 0, marginBottom: -24 }}>
            <div className="notice" role="alert" style={{ marginBottom: 0 }}>
              <CircleAlert size={18} />
              <span>Some data didn't load, so parts of this page may be out of date.</span>
              <button type="button" className="btn btn-secondary" onClick={() => load(true)}>
                Try again
              </button>
            </div>
          </div>
        )}

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
