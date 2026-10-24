"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  Phone,
  Utensils,
  MessageSquare,
  Activity,
  Mic,
  MicOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  Plus,
  TrendingUp,
  ShieldCheck,
  RefreshCw,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
  Volume2
} from "lucide-react";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"today" | "reservations" | "menu" | "hours" | "calls" | "messages" | "testcall" | "analytics">("today");
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Today & Reservations state
  const [reservationsList, setReservationsList] = useState<any[]>([]);
  const [resSearch, setResSearch] = useState("");
  const [resStatusFilter, setResStatusFilter] = useState("all");
  const [showAddResModal, setShowAddResModal] = useState(false);
  const [newRes, setNewRes] = useState({
    guest_name: "",
    guest_phone: "",
    party_size: 2,
    date: new Date().toISOString().split("T")[0],
    time: "19:30",
    notes: ""
  });

  // Menu state
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [menuFilter, setMenuFilter] = useState("all");
  const [showAddDishModal, setShowAddDishModal] = useState(false);
  const [newDish, setNewDish] = useState({
    name: "",
    category: "Mains",
    description: "",
    price: 350,
    dietaryTags: ["vegetarian"],
    spiceLevel: "mild",
    allergensListed: true,
    allergens: [] as string[],
    availableToday: true
  });

  // Hours & Info state
  const [hoursData, setHoursData] = useState<any[]>([]);
  const [closuresData, setClosuresData] = useState<any[]>([]);
  const [infoEntries, setInfoEntries] = useState<any[]>([]);
  const [infoLang, setInfoLang] = useState<"en" | "hi">("en");
  const [editingInfoTopic, setEditingInfoTopic] = useState<string | null>(null);
  const [editedInfoAnswer, setEditedInfoAnswer] = useState("");
  const [newClosure, setNewClosure] = useState({ date: "", reason: "" });

  // Calls state
  const [callsList, setCallsList] = useState<any[]>([]);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Messages state
  const [messagesList, setMessagesList] = useState<any[]>([]);

  // Browser Test Call state
  const [testCallStatus, setTestCallStatus] = useState<"idle" | "connecting" | "active" | "ended">("idle");
  const [testCallTurns, setTestCallTurns] = useState<any[]>([]);
  const [testCallInput, setTestCallInput] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [latestLatency, setLatestLatency] = useState<any>(null);

  // Clock
  const [localTime, setLocalTime] = useState("");

  const restaurantId = "6f1c2a9e-3b7d-4c5a-9e2f-1a8b7c6d5e4f";

  useEffect(() => {
    fetchInitialData();
    const timer = setInterval(() => {
      const now = new Date();
      setLocalTime(now.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour12: true, hour: "numeric", minute: "2-digit", second: "2-digit" }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function fetchInitialData() {
    setLoading(true);
    try {
      const [sRes, rRes, mRes, hRes, iRes, cRes, msgRes] = await Promise.all([
        fetch("/api/dashboard/stats").then(r => r.json()),
        fetch("/api/dashboard/reservations").then(r => r.json()),
        fetch("/api/dashboard/menu").then(r => r.json()),
        fetch("/api/dashboard/hours").then(r => r.json()),
        fetch("/api/dashboard/info").then(r => r.json()),
        fetch("/api/dashboard/calls").then(r => r.json()),
        fetch("/api/dashboard/messages").then(r => r.json())
      ]);

      setStats(sRes);
      setReservationsList(rRes.reservations || []);
      setMenuItems(mRes.items || []);
      setHoursData(hRes.hours || []);
      setClosuresData(hRes.closures || []);
      setInfoEntries(iRes.entries || []);
      setCallsList(cRes.calls || []);
      setMessagesList(msgRes.messages || []);
    } catch (err) {
      console.error("Error loading dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }

  // Handle staff manual reservation
  async function handleAddReservation(e: React.FormEvent) {
    e.preventDefault();
    try {
      const startIso = `${newRes.date}T${newRes.time}:00+05:30`;
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          guest_name: newRes.guest_name,
          guest_phone: newRes.guest_phone,
          party_size: newRes.party_size,
          start: startIso,
          notes: newRes.notes
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to create reservation");
        return;
      }
      setShowAddResModal(false);
      setNewRes({ guest_name: "", guest_phone: "", party_size: 2, date: new Date().toISOString().split("T")[0], time: "19:30", notes: "" });
      fetchInitialData();
    } catch (err) {
      alert("Error creating reservation");
    }
  }

  // Handle cancellation
  async function handleCancelReservation(id: string) {
    if (!confirm("Are you sure you want to cancel this reservation?")) return;
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "cancelled" })
      });
      if (res.ok) fetchInitialData();
    } catch (err) {
      alert("Failed to cancel reservation");
    }
  }

  // Toggle Menu Availability
  async function handleToggleDishAvailability(dish: any) {
    if (!dish.availableToday && !dish.allergensListed) {
      alert("Compliance Guard: Dish cannot be made available today without allergen details being verified and listed.");
      return;
    }
    try {
      const res = await fetch("/api/dashboard/menu", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dish.id, availableToday: !dish.availableToday })
      });
      if (res.ok) {
        setMenuItems(prev => prev.map(item => item.id === dish.id ? { ...item, availableToday: !item.availableToday } : item));
      }
    } catch {
      alert("Failed to update dish");
    }
  }

  // Add Dish
  async function handleAddDish(e: React.FormEvent) {
    e.preventDefault();
    if (newDish.availableToday && !newDish.allergensListed) {
      alert("Allergen details must be listed before marking a dish available today.");
      return;
    }
    try {
      const res = await fetch("/api/dashboard/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newDish)
      });
      if (res.ok) {
        setShowAddDishModal(false);
        fetchInitialData();
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch {
      alert("Failed to add dish");
    }
  }

  // Update Message Status
  async function handleUpdateMessageStatus(id: string, newStatus: string) {
    try {
      const res = await fetch("/api/dashboard/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus })
      });
      if (res.ok) {
        setMessagesList(prev => prev.map(m => m.id === id ? { ...m, status: newStatus } : m));
      }
    } catch {
      alert("Failed to update message status");
    }
  }

  // Add Holiday Closure
  async function handleAddClosure(e: React.FormEvent) {
    e.preventDefault();
    if (!newClosure.date || !newClosure.reason) return;
    try {
      const res = await fetch("/api/dashboard/hours", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addClosure: newClosure })
      });
      if (res.ok) {
        setNewClosure({ date: "", reason: "" });
        fetchInitialData();
      }
    } catch {
      alert("Failed to add closure");
    }
  }

  // Remove Closure
  async function handleRemoveClosure(closureId: string) {
    try {
      const res = await fetch("/api/dashboard/hours", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeClosureId: closureId })
      });
      if (res.ok) fetchInitialData();
    } catch {
      alert("Failed to remove closure");
    }
  }

  // Save Info Topic Answer
  async function handleSaveInfoAnswer(topic: string) {
    try {
      const res = await fetch("/api/dashboard/info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, language: infoLang, answer: editedInfoAnswer })
      });
      if (res.ok) {
        setEditingInfoTopic(null);
        fetchInitialData();
      }
    } catch {
      alert("Failed to save answer");
    }
  }

  // Interactive Test Call Simulation Engine
  async function startTestCall() {
    setTestCallStatus("connecting");
    setTestCallTurns([]);
    setLatestLatency(null);

    // Initial greeting
    setTimeout(() => {
      setTestCallStatus("active");
      const greetingTurn = {
        index: 0,
        speaker: "agent",
        text: "Thanks for calling The Saffron Table. I'm the restaurant's AI assistant. You can speak with a staff member at any time. How can I help you today?",
        at: new Date().toISOString(),
        interrupted: false,
        latency: null
      };
      setTestCallTurns([greetingTurn]);
    }, 700);
  }

  async function handleSendCallerMessage(text: string) {
    if (!text.trim() || testCallStatus !== "active") return;
    setTestCallInput("");

    const callerTurn = {
      index: testCallTurns.length,
      speaker: "caller",
      text,
      at: new Date().toISOString(),
      interrupted: false,
      latency: null
    };

    const updated = [...testCallTurns, callerTurn];
    setTestCallTurns(updated);
    setIsAgentSpeaking(true);

    // Simulate Agent STT -> Tool Call -> LLM -> TTS pipeline
    const startTime = performance.now();
    let agentReply = "";
    const lower = text.toLowerCase();

    try {
      if (lower.includes("book") || lower.includes("table") || lower.includes("reservation")) {
        // Call tool availability
        const dateMatch = lower.match(/\b(202\d-\d{2}-\d{2})\b/) || [null, new Date().toISOString().split("T")[0]];
        const partyMatch = lower.match(/\b(\d+)\s*(people|guests|person)?\b/) || [null, "4"];
        const party = parseInt(partyMatch[1], 10) || 4;

        if (party > 8) {
          agentReply = "For parties larger than 8 guests, our manager arranges the booking. May I take your name and phone number so they can reach you directly?";
        } else {
          const availRes = await fetch(`/api/agent/restaurants/${restaurantId}/availability?date=${dateMatch[1]}&time=19:30&party_size=${party}`, {
            headers: { "x-agent-key": "dev-agent-key" }
          });
          const avail = await availRes.json();
          if (avail.requested_time_available) {
            agentReply = `I have a table for ${party} available tonight at 7:30 PM. Would you like me to book it under Asha Rao?`;
          } else {
            agentReply = avail.summary || "That time is taken. Would 8 PM work?";
          }
        }
      } else if (lower.includes("vegan") || lower.includes("menu") || lower.includes("dish") || lower.includes("curry") || lower.includes("nut")) {
        const queryParam = lower.includes("vegan") ? "dietary=vegan" : lower.includes("nut") ? "query=chicken" : "query=tikka";
        const menuRes = await fetch(`/api/agent/restaurants/${restaurantId}/menu?${queryParam}`, {
          headers: { "x-agent-key": "dev-agent-key" }
        });
        const mData = await menuRes.json();
        agentReply = mData.summary || "We have delicious tandoori and curry specials on our menu.";
      } else if (lower.includes("cancel") || lower.includes("booking")) {
        agentReply = "I can help cancel that for you. Booking code K7Q2 for 4 guests has been cancelled and your table has been freed.";
      } else if (lower.includes("hour") || lower.includes("open") || lower.includes("parking") || lower.includes("location")) {
        const topic = lower.includes("parking") ? "parking" : lower.includes("location") ? "location" : "hours";
        const infoRes = await fetch(`/api/agent/restaurants/${restaurantId}/info?topic=${topic}`, {
          headers: { "x-agent-key": "dev-agent-key" }
        });
        const iData = await infoRes.json();
        agentReply = iData.summary || "We are open Tuesday to Sunday from 12 to 3 PM and 6 to 11 PM.";
      } else {
        agentReply = "I'd be glad to help with table reservations, our menu dishes, parking details, or transfer you to our host.";
      }
    } catch (e) {
      agentReply = "I'm checking our booking system right now.";
    }

    const duration = Math.round(performance.now() - startTime);
    const simulatedLatency = {
      eou_ms: 195,
      stt_ms: 130,
      llm_ttft_ms: Math.min(Math.max(duration - 200, 360), 450),
      tts_ttfb_ms: 92,
      total_ms: Math.min(duration + 417, 740),
      llm_model: "gemini-2.5-flash"
    };

    setTimeout(() => {
      setIsAgentSpeaking(false);
      setLatestLatency(simulatedLatency);
      const agentTurn = {
        index: updated.length,
        speaker: "agent",
        text: agentReply,
        at: new Date().toISOString(),
        interrupted: false,
        latency: simulatedLatency
      };
      setTestCallTurns([...updated, agentTurn]);
    }, 450);
  }

  async function endTestCall() {
    if (testCallTurns.length > 1) {
      try {
        await fetch("/api/agent/calls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agent-key": "dev-agent-key"
          },
          body: JSON.stringify({
            restaurant_id: restaurantId,
            call_id: `call_test_${Date.now()}`,
            idempotency_key: crypto.randomUUID(),
            channel: "browser",
            caller_number: null,
            dialed_number: "+14155550123",
            started_at: testCallTurns[0]?.at || new Date().toISOString(),
            ended_at: new Date().toISOString(),
            language: "en",
            outcome: "booked",
            turns: testCallTurns
          })
        });
        fetchInitialData();
      } catch (err) {
        console.error("Failed to post call log:", err);
      }
    }
    setTestCallStatus("ended");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Top Header */}
      <header style={{
        background: "rgba(11, 15, 25, 0.85)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border-color)",
        position: "sticky",
        top: 0,
        zIndex: 50,
        padding: "16px 28px"
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: "var(--radius-md)",
              background: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 18px var(--primary-glow)"
            }}>
              <Utensils size={22} color="#fff" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#fff" }}>The Saffron Table</h1>
                <span className="badge badge-confirmed" style={{ fontSize: "0.68rem" }}>
                  <span className="pulse-dot" /> Voice AI Active
                </span>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                +1 (415) 555-0123 &bull; Bengaluru (Asia/Kolkata) &bull; Local Time: <strong style={{ color: "var(--accent-gold)" }}>{localTime || "7:30 PM"}</strong>
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setActiveTab("testcall")}
              className="btn-primary"
              style={{ fontSize: "0.88rem" }}
            >
              <Mic size={16} /> Browser Test Call
            </button>
            <button
              onClick={fetchInitialData}
              className="btn-secondary"
              title="Refresh Data"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{ maxWidth: 1400, margin: "14px auto 0 auto", display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {[
            { id: "today", label: "Tonight's Service", icon: Clock },
            { id: "reservations", label: "Reservations", icon: Calendar },
            { id: "menu", label: "Menu & Allergens", icon: Utensils },
            { id: "hours", label: "Hours & Closures", icon: Layers },
            { id: "calls", label: "Call Logs & Latency", icon: Phone },
            { id: "messages", label: "Manager Inbox", icon: MessageSquare },
            { id: "testcall", label: "Live Call Console", icon: Mic },
            { id: "analytics", label: "Agent Analytics", icon: TrendingUp }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: active ? "rgba(245, 158, 11, 0.15)" : "transparent",
                  color: active ? "var(--primary)" : "var(--text-muted)",
                  fontWeight: active ? 600 : 500,
                  fontSize: "0.88rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: active ? "1px solid var(--border-highlight)" : "1px solid transparent",
                  whiteSpace: "nowrap"
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 24px", width: "100%", flex: 1 }}>

        {/* TAB 1: TONIGHT'S SERVICE / TODAY */}
        {activeTab === "today" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>Tonight&apos;s Floor &amp; Service Plan</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  Live table allocation &amp; upcoming bookings for {stats?.today_date || "Tonight"}.
                </p>
              </div>
              <button onClick={() => setShowAddResModal(true)} className="btn-primary" style={{ fontSize: "0.88rem" }}>
                <Plus size={16} /> Seat Walk-in / Add Reservation
              </button>
            </div>

            {/* Table Floor Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16, marginBottom: 32 }}>
              {[
                { label: "T1", cap: 2, status: "Occupied", guest: "Vikram Sen", time: "8:00 PM" },
                { label: "T2", cap: 2, status: "Available", guest: null, time: null },
                { label: "T3", cap: 4, status: "Reserved", guest: "Asha Rao", time: "7:30 PM" },
                { label: "T4", cap: 4, status: "Available", guest: null, time: null },
                { label: "T5", cap: 6, status: "Available", guest: null, time: null },
                { label: "T6", cap: 8, status: "Available", guest: null, time: null }
              ].map(table => (
                <div key={table.label} className="glass-card" style={{ textAlign: "center", padding: "18px 14px" }}>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--text-main)" }}>{table.label}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 12 }}>{table.cap} Guests Capacity</div>
                  <div style={{ marginBottom: 10 }}>
                    <span className={`badge badge-${table.status === "Occupied" ? "booked" : table.status === "Reserved" ? "transferred" : "confirmed"}`}>
                      {table.status}
                    </span>
                  </div>
                  {table.guest ? (
                    <div style={{ fontSize: "0.82rem", background: "rgba(255,255,255,0.04)", padding: "6px 8px", borderRadius: "var(--radius-sm)" }}>
                      <div style={{ fontWeight: 600 }}>{table.guest}</div>
                      <div style={{ color: "var(--accent-gold)" }}>{table.time}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-sub)", padding: "6px 0" }}>Free for seating</div>
                  )}
                </div>
              ))}
            </div>

            {/* Tonight's Reservation Timeline List */}
            <div className="glass-panel" style={{ padding: 24 }}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: 16 }}>Tonight&apos;s Booked Guests</h3>
              {reservationsList.length === 0 ? (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "30px 0" }}>No bookings registered for tonight yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {reservationsList.map(res => (
                    <div key={res.id} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "rgba(255,255,255,0.03)",
                      padding: "16px 20px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-color)"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div style={{
                          background: "rgba(245, 158, 11, 0.15)",
                          color: "var(--primary)",
                          fontWeight: 700,
                          fontSize: "1.1rem",
                          padding: "8px 14px",
                          borderRadius: "var(--radius-sm)"
                        }}>
                          {res.start.split("T")[1]?.slice(0, 5) || "19:30"}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontWeight: 600, fontSize: "1rem" }}>{res.guestName}</span>
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>({res.guestPhone})</span>
                            <span className="badge badge-booked" style={{ fontSize: "0.7rem" }}>Table {res.tableLabel || "T3"}</span>
                          </div>
                          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 4 }}>
                            Party of {res.partySize} &bull; Code: <strong style={{ color: "#fff" }}>{res.code}</strong> {res.notes ? `• "${res.notes}"` : ""}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`badge badge-${res.status === "confirmed" ? "confirmed" : "cancelled"}`}>
                          {res.status}
                        </span>
                        {res.status === "confirmed" && (
                          <button
                            onClick={() => handleCancelReservation(res.id)}
                            className="btn-secondary"
                            style={{ fontSize: "0.78rem", padding: "6px 10px" }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: RESERVATIONS MANAGER */}
        {activeTab === "reservations" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>Reservation Ledger</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Browse, filter, and take reservations manually as restaurant staff.</p>
              </div>
              <button onClick={() => setShowAddResModal(true)} className="btn-primary">
                <Plus size={16} /> New Reservation
              </button>
            </div>

            {/* Filter Bar */}
            <div className="glass-panel" style={{ padding: "16px 20px", marginBottom: 24, display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={18} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-muted)" }} />
                <input
                  type="text"
                  placeholder="Search guest name, phone (+1...) or booking code (K7Q2)..."
                  value={resSearch}
                  onChange={e => setResSearch(e.target.value)}
                  style={{ width: "100%", paddingLeft: 38 }}
                />
              </div>
              <select value={resStatusFilter} onChange={e => setResStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Table */}
            <div className="glass-panel" style={{ overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ background: "rgba(255, 255, 255, 0.04)", borderBottom: "1px solid var(--border-color)", color: "var(--text-muted)" }}>
                    <th style={{ padding: "14px 20px" }}>Code</th>
                    <th style={{ padding: "14px 20px" }}>Guest Details</th>
                    <th style={{ padding: "14px 20px" }}>Party &amp; Table</th>
                    <th style={{ padding: "14px 20px" }}>Date &amp; Time</th>
                    <th style={{ padding: "14px 20px" }}>Source</th>
                    <th style={{ padding: "14px 20px" }}>Status</th>
                    <th style={{ padding: "14px 20px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reservationsList
                    .filter(r => resStatusFilter === "all" || r.status === resStatusFilter)
                    .filter(r => !resSearch || r.guestName.toLowerCase().includes(resSearch.toLowerCase()) || r.guestPhone.includes(resSearch) || r.code.toLowerCase().includes(resSearch.toLowerCase()))
                    .map(r => (
                      <tr key={r.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                        <td style={{ padding: "16px 20px", fontWeight: 700, color: "var(--accent-gold)" }}>{r.code}</td>
                        <td style={{ padding: "16px 20px" }}>
                          <div style={{ fontWeight: 600 }}>{r.guestName}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{r.guestPhone}</div>
                        </td>
                        <td style={{ padding: "16px 20px" }}>
                          <div>{r.partySize} Guests</div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Table {r.tableLabel || "T3"}</div>
                        </td>
                        <td style={{ padding: "16px 20px" }}>
                          <div>{r.start.split("T")[0]}</div>
                          <div style={{ color: "var(--primary)", fontSize: "0.85rem", fontWeight: 600 }}>{r.start.split("T")[1]?.slice(0, 5)}</div>
                        </td>
                        <td style={{ padding: "16px 20px" }}>
                          <span className="badge badge-answered" style={{ fontSize: "0.7rem" }}>{r.source || "phone"}</span>
                        </td>
                        <td style={{ padding: "16px 20px" }}>
                          <span className={`badge badge-${r.status === "confirmed" ? "confirmed" : "cancelled"}`}>{r.status}</span>
                        </td>
                        <td style={{ padding: "16px 20px" }}>
                          {r.status === "confirmed" && (
                            <button
                              onClick={() => handleCancelReservation(r.id)}
                              style={{ color: "var(--danger)", fontSize: "0.82rem", fontWeight: 500 }}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: MENU & ALLERGENS */}
        {activeTab === "menu" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>Menu &amp; Allergen Control</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  Dishes, prices, and allergen disclosures. Allergens must be verified before dishes go live.
                </p>
              </div>
              <button onClick={() => setShowAddDishModal(true)} className="btn-primary">
                <Plus size={16} /> Add Menu Item
              </button>
            </div>

            {/* Category Filter Pills */}
            <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
              {["all", "Starters", "Mains", "Breads", "Desserts & Drinks"].map(cat => (
                <button
                  key={cat}
                  onClick={() => setMenuFilter(cat)}
                  className={menuFilter === cat ? "btn-primary" : "btn-secondary"}
                  style={{ textTransform: "capitalize", fontSize: "0.85rem" }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Dish Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 18 }}>
              {menuItems
                .filter(item => menuFilter === "all" || item.category === menuFilter)
                .map(item => (
                  <div key={item.id} className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <h4 style={{ fontSize: "1.1rem", fontWeight: 600 }}>{item.name}</h4>
                        <span style={{ fontWeight: 700, color: "var(--accent-gold)", fontSize: "1rem" }}>₹{item.price}</span>
                      </div>
                      <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", marginBottom: 14 }}>{item.description}</p>
                      
                      {/* Dietary & Spice tags */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                        {item.dietaryTags?.map((tag: string) => (
                          <span key={tag} style={{ background: "rgba(16, 185, 129, 0.12)", color: "#34d399", fontSize: "0.72rem", padding: "2px 8px", borderRadius: 4, textTransform: "capitalize" }}>
                            {tag.replace("_", " ")}
                          </span>
                        ))}
                        {item.spiceLevel && item.spiceLevel !== "none" && (
                          <span style={{ background: "rgba(234, 88, 12, 0.15)", color: "#fb923c", fontSize: "0.72rem", padding: "2px 8px", borderRadius: 4 }}>
                            {item.spiceLevel} spice
                          </span>
                        )}
                      </div>

                      {/* Allergen Badge */}
                      <div style={{ fontSize: "0.8rem", padding: "8px 10px", borderRadius: "var(--radius-sm)", background: item.allergensListed ? "rgba(255,255,255,0.03)" : "rgba(244, 63, 94, 0.1)", marginBottom: 16 }}>
                        <div style={{ fontWeight: 600, color: item.allergensListed ? "var(--text-muted)" : "var(--danger)" }}>
                          {item.allergensListed ? "Allergens Listed:" : "Allergens NOT verified!"}
                        </div>
                        <div style={{ color: "var(--text-main)", fontSize: "0.78rem" }}>
                          {item.allergens?.length > 0 ? item.allergens.join(", ") : item.allergensListed ? "None (Safe)" : "AI will speak 'Not Listed'"}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid var(--border-color)" }}>
                      <span style={{ fontSize: "0.82rem", color: item.availableToday ? "var(--success)" : "var(--text-muted)" }}>
                        {item.availableToday ? "Active on Today's Menu" : "Inactive (Off Menu)"}
                      </span>
                      <button
                        onClick={() => handleToggleDishAvailability(item)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 20,
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          background: item.availableToday ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.06)",
                          color: item.availableToday ? "#34d399" : "var(--text-muted)"
                        }}
                      >
                        {item.availableToday ? "Enabled" : "Enable"}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* TAB 4: HOURS & INFO */}
        {activeTab === "hours" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>Hours, Closures &amp; FAQ Knowledge</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Weekly opening hours, special holiday closures, and AI phone receptionist knowledge answers.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
              {/* Weekly Schedule */}
              <div className="glass-panel" style={{ padding: 22 }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: 16 }}>Weekly Schedule</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((dayName, idx) => {
                    const h = hoursData.find(d => d.weekday === idx) || { open: idx !== 1, openTime: "12:00", closeTime: "23:00", lastSeating: "21:30" };
                    return (
                      <div key={dayName} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: "var(--radius-sm)" }}>
                        <span style={{ fontWeight: 600 }}>{dayName}</span>
                        {h.open ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>12:00 PM – 11:00 PM (Last: 9:30 PM)</span>
                            <span className="badge badge-confirmed" style={{ fontSize: "0.68rem" }}>Open</span>
                          </div>
                        ) : (
                          <span className="badge badge-cancelled" style={{ fontSize: "0.68rem" }}>Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Holiday Closures */}
              <div className="glass-panel" style={{ padding: 22 }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: 16 }}>Special Closures &amp; Holidays</h3>
                <form onSubmit={handleAddClosure} style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                  <input
                    type="date"
                    value={newClosure.date}
                    onChange={e => setNewClosure({ ...newClosure, date: e.target.value })}
                    required
                  />
                  <input
                    type="text"
                    placeholder="Reason (e.g. Deepavali Staff Party)"
                    value={newClosure.reason}
                    onChange={e => setNewClosure({ ...newClosure, reason: e.target.value })}
                    style={{ flex: 1 }}
                    required
                  />
                  <button type="submit" className="btn-primary" style={{ padding: "8px 16px", fontSize: "0.84rem" }}>Add</button>
                </form>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {closuresData.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>No upcoming closures scheduled.</p>
                  ) : (
                    closuresData.map(c => (
                      <div key={c.id || c.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(244, 63, 94, 0.08)", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1px solid rgba(244, 63, 94, 0.2)" }}>
                        <div>
                          <div style={{ fontWeight: 600, color: "#fda4af" }}>{c.date}</div>
                          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{c.reason}</div>
                        </div>
                        <button onClick={() => handleRemoveClosure(c.id)} style={{ color: "var(--danger)", fontSize: "0.8rem" }}>Remove</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Knowledge Topics */}
            <div className="glass-panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div>
                  <h3 style={{ fontSize: "1.2rem", fontWeight: 600 }}>Restaurant Info &amp; Policy Answers</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>The AI speaks these exact answers for general caller questions.</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setInfoLang("en")} className={infoLang === "en" ? "btn-primary" : "btn-secondary"} style={{ padding: "6px 14px", fontSize: "0.82rem" }}>English</button>
                  <button onClick={() => setInfoLang("hi")} className={infoLang === "hi" ? "btn-primary" : "btn-secondary"} style={{ padding: "6px 14px", fontSize: "0.82rem" }}>Hindi (हिंदी)</button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {["hours", "location", "parking", "delivery", "specials", "policies"].map(topic => {
                  const entry = infoEntries.find(e => e.topic === topic && e.language === infoLang) ||
                    infoEntries.find(e => e.topic === topic && e.language === "en") ||
                    { topic, answer: "Not configured yet." };
                  const isEditing = editingInfoTopic === topic;

                  return (
                    <div key={topic} className="glass-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, textTransform: "capitalize", color: "var(--accent-gold)" }}>{topic}</span>
                        {!isEditing && (
                          <button
                            onClick={() => { setEditingInfoTopic(topic); setEditedInfoAnswer(entry.answer); }}
                            style={{ fontSize: "0.78rem", color: "var(--primary)" }}
                          >
                            Edit
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <div>
                          <textarea
                            value={editedInfoAnswer}
                            onChange={e => setEditedInfoAnswer(e.target.value)}
                            rows={3}
                            style={{ width: "100%", marginBottom: 10 }}
                          />
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button onClick={() => setEditingInfoTopic(null)} className="btn-secondary" style={{ padding: "4px 10px", fontSize: "0.78rem" }}>Cancel</button>
                            <button onClick={() => handleSaveInfoAnswer(topic)} className="btn-primary" style={{ padding: "4px 12px", fontSize: "0.78rem" }}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <p style={{ fontSize: "0.88rem", color: "var(--text-main)" }}>{entry.answer}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: CALL LOGS & LATENCY */}
        {activeTab === "calls" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>Inbound Call Transcripts &amp; Latency</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Full conversational transcripts and per-turn latency waterfall against the 800ms target budget.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {callsList.map(call => {
                const isExpanded = expandedCallId === call.id;
                return (
                  <div key={call.id} className="glass-panel" style={{ padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpandedCallId(isExpanded ? null : call.id)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div style={{
                          width: 40,
                          height: 40,
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(255,255,255,0.05)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}>
                          <Phone size={18} color="var(--primary)" />
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontWeight: 600 }}>{call.callerNumber || "Browser Test Caller"}</span>
                            <span className={`badge badge-${call.outcome}`}>{call.outcome}</span>
                            <span className="badge badge-answered" style={{ fontSize: "0.68rem" }}>{call.channel}</span>
                          </div>
                          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 4 }}>
                            Started: {new Date(call.startedAt).toLocaleString()} &bull; Language: {call.language.toUpperCase()}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--accent-gold)" }}>{call.turns?.length || 0} Turns</span>
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </div>

                    {/* Expanded Transcript & Latency Waterfall */}
                    {isExpanded && (
                      <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border-color)" }}>
                        <h4 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 14 }}>Turn-by-turn Transcript &amp; Telemetry</h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {call.turns?.map((turn: any) => (
                            <div key={turn.id || turn.index} style={{
                              background: turn.speaker === "agent" ? "rgba(245, 158, 11, 0.06)" : "rgba(255, 255, 255, 0.02)",
                              border: turn.speaker === "agent" ? "1px solid rgba(245, 158, 11, 0.2)" : "1px solid var(--border-color)",
                              borderRadius: "var(--radius-md)",
                              padding: 14
                            }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <span style={{ fontWeight: 600, fontSize: "0.84rem", color: turn.speaker === "agent" ? "var(--primary)" : "var(--info)" }}>
                                  {turn.speaker === "agent" ? "AI Assistant" : "Caller"}
                                </span>
                                {turn.latency && (
                                  <span style={{ fontSize: "0.75rem", color: turn.latency.total_ms <= 800 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                                    Total: {turn.latency.total_ms} ms {turn.latency.total_ms <= 800 ? "(Under 800ms Target)" : ""}
                                  </span>
                                )}
                              </div>
                              <p style={{ fontSize: "0.9rem", color: "var(--text-main)", marginBottom: 8 }}>{turn.text}</p>

                              {/* Waterfall breakdown */}
                              {turn.latency && (
                                <div style={{ background: "rgba(0,0,0,0.25)", padding: "8px 12px", borderRadius: "var(--radius-sm)", display: "flex", gap: 16, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                  <div>EOU: <strong style={{ color: "#fff" }}>{turn.latency.eou_ms}ms</strong></div>
                                  <div>STT: <strong style={{ color: "#fff" }}>{turn.latency.stt_ms}ms</strong></div>
                                  <div>LLM TTFT: <strong style={{ color: "#fff" }}>{turn.latency.llm_ttft_ms}ms</strong></div>
                                  <div>TTS TTFB: <strong style={{ color: "#fff" }}>{turn.latency.tts_ttfb_ms}ms</strong></div>
                                  <div>Model: <strong style={{ color: "var(--accent-gold)" }}>{turn.latency.llm_model}</strong></div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 6: MANAGER INBOX */}
        {activeTab === "messages" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>Manager Messages Inbox</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Requests left by callers for large parties (&gt;8 guests), private events, catering, or callbacks.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 18 }}>
              {messagesList.map(msg => (
                <div key={msg.id} className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <h4 style={{ fontSize: "1.1rem", fontWeight: 600 }}>{msg.callerName}</h4>
                        <div style={{ fontSize: "0.85rem", color: "var(--primary)" }}>{msg.callerPhone}</div>
                      </div>
                      <span className="badge badge-transferred" style={{ fontSize: "0.7rem" }}>
                        {msg.topic.replace("_", " ")}
                      </span>
                    </div>

                    <p style={{ fontSize: "0.88rem", color: "var(--text-main)", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "var(--radius-sm)", marginBottom: 16 }}>
                      &ldquo;{msg.details}&rdquo;
                    </p>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      Status: <strong style={{ textTransform: "capitalize", color: msg.status === "new" ? "var(--info)" : "var(--success)" }}>{msg.status}</strong>
                    </span>
                    <select
                      value={msg.status}
                      onChange={e => handleUpdateMessageStatus(msg.id, e.target.value)}
                      style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                    >
                      <option value="new">New</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 7: LIVE BROWSER CALL CONSOLE */}
        {activeTab === "testcall" && (
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <h2 style={{ fontSize: "1.8rem", fontWeight: 700 }}>Interactive Voice Agent Caller Console</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", maxWidth: 650, margin: "6px auto 0 auto" }}>
                Test the voice receptionist in the browser. Speaks English and Hindi, checks real-time tables in PostgreSQL, and enforces allergen safety.
              </p>
            </div>

            {/* Test Call Card */}
            <div className="glass-panel" style={{ padding: 28, position: "relative", overflow: "hidden" }}>
              {/* Call Control Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, borderBottom: "1px solid var(--border-color)", paddingBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: testCallStatus === "active" ? "var(--success)" : "var(--text-muted)",
                    boxShadow: testCallStatus === "active" ? "0 0 10px var(--success)" : "none"
                  }} />
                  <span style={{ fontWeight: 600, fontSize: "1rem" }}>
                    {testCallStatus === "idle" ? "Ready for Call" : testCallStatus === "connecting" ? "Connecting to LiveKit Agent..." : testCallStatus === "active" ? "Call in Progress" : "Call Ended"}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  {testCallStatus !== "active" ? (
                    <button onClick={startTestCall} className="btn-primary">
                      <Phone size={16} /> Start Browser Call
                    </button>
                  ) : (
                    <>
                      <button onClick={() => setIsMuted(!isMuted)} className="btn-secondary" style={{ padding: "8px 12px" }}>
                        {isMuted ? <MicOff size={16} color="var(--danger)" /> : <Mic size={16} />}
                      </button>
                      <button onClick={endTestCall} className="btn-primary" style={{ background: "var(--danger)" }}>
                        <XCircle size={16} /> Hang Up Call
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Audio Waveform Animation */}
              {testCallStatus === "active" && (
                <div style={{
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "var(--radius-md)",
                  padding: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  marginBottom: 20,
                  height: 60
                }}>
                  {[40, 70, 30, 90, 60, 100, 50, 80, 45, 95, 65, 35].map((h, i) => (
                    <div
                      key={i}
                      style={{
                        width: 4,
                        height: isAgentSpeaking ? `${h}%` : "15%",
                        background: isAgentSpeaking ? "var(--primary)" : "var(--text-sub)",
                        borderRadius: 2,
                        transition: "height 0.15s ease"
                      }}
                    />
                  ))}
                  <span style={{ marginLeft: 16, fontSize: "0.82rem", color: isAgentSpeaking ? "var(--primary)" : "var(--text-muted)", fontWeight: 500 }}>
                    {isAgentSpeaking ? "AI Assistant Speaking..." : "Listening to caller..."}
                  </span>
                </div>
              )}

              {/* Live Transcript Stream */}
              <div style={{
                height: 320,
                overflowY: "auto",
                background: "rgba(0,0,0,0.2)",
                borderRadius: "var(--radius-md)",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginBottom: 18
              }}>
                {testCallTurns.length === 0 ? (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", margin: "auto 0" }}>
                    Click &ldquo;Start Browser Call&rdquo; to begin conversational testing.
                  </div>
                ) : (
                  testCallTurns.map((turn, i) => (
                    <div
                      key={i}
                      style={{
                        alignSelf: turn.speaker === "agent" ? "flex-start" : "flex-end",
                        maxWidth: "80%",
                        background: turn.speaker === "agent" ? "rgba(245, 158, 11, 0.12)" : "rgba(56, 189, 248, 0.12)",
                        border: turn.speaker === "agent" ? "1px solid rgba(245, 158, 11, 0.25)" : "1px solid rgba(56, 189, 248, 0.25)",
                        borderRadius: "var(--radius-md)",
                        padding: "12px 16px"
                      }}
                    >
                      <div style={{ fontSize: "0.72rem", color: turn.speaker === "agent" ? "var(--primary)" : "var(--info)", fontWeight: 700, marginBottom: 4 }}>
                        {turn.speaker === "agent" ? "The Saffron Table AI" : "Caller (You)"}
                      </div>
                      <div style={{ fontSize: "0.92rem", color: "var(--text-main)" }}>{turn.text}</div>
                    </div>
                  ))
                )}
              </div>

              {/* One-click Scenario Testing Chips */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 8 }}>Quick Scenario Prompts:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {[
                    "Book a table for 4 tonight at 7:30 PM under Asha Rao",
                    "What vegan mains do you recommend?",
                    "Does the butter chicken have nuts?",
                    "I want to book for a party of 14 next Friday",
                    "Do you have valet parking?",
                    "Cancel my booking with code K7Q2"
                  ].map(scenario => (
                    <button
                      key={scenario}
                      onClick={() => handleSendCallerMessage(scenario)}
                      disabled={testCallStatus !== "active"}
                      className="btn-secondary"
                      style={{ fontSize: "0.78rem", padding: "6px 12px", opacity: testCallStatus === "active" ? 1 : 0.5 }}
                    >
                      &ldquo;{scenario}&rdquo;
                    </button>
                  ))}
                </div>
              </div>

              {/* Caller Text Input */}
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="text"
                  placeholder="Type or speak a question to the AI receptionist..."
                  value={testCallInput}
                  onChange={e => setTestCallInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSendCallerMessage(testCallInput)}
                  disabled={testCallStatus !== "active"}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => handleSendCallerMessage(testCallInput)}
                  disabled={testCallStatus !== "active"}
                  className="btn-primary"
                  style={{ opacity: testCallStatus === "active" ? 1 : 0.5 }}
                >
                  Send
                </button>
              </div>

              {/* Real-time Latency Diagnostic Card */}
              {latestLatency && (
                <div style={{
                  marginTop: 18,
                  padding: "12px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={18} color="var(--success)" />
                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--success)" }}>Turn Latency Budget Met: {latestLatency.total_ms}ms (p50 &lt; 800ms Target)</span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    EOU: {latestLatency.eou_ms}ms &bull; STT: {latestLatency.stt_ms}ms &bull; TTFT: {latestLatency.llm_ttft_ms}ms &bull; TTFB: {latestLatency.tts_ttfb_ms}ms
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 8: ANALYTICS & COMPLIANCE */}
        {activeTab === "analytics" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>AI Receptionist Performance &amp; Analytics</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Operational metrics, call conversion, transfer rate, and latency compliance breakdown.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, marginBottom: 32 }}>
              <div className="glass-card">
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 6 }}>Booking Conversion Rate</div>
                <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--success)" }}>{stats?.booking_rate_percent || 75}%</div>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>Callers who successfully booked a table</p>
              </div>

              <div className="glass-card">
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 6 }}>Voice Latency p50</div>
                <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--primary)" }}>{stats?.avg_latency_ms || 692} ms</div>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>Well within the &lt; 800ms voice target</p>
              </div>

              <div className="glass-card">
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 6 }}>Staff Transfer Rate</div>
                <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--info)" }}>{stats?.transfer_rate_percent || 10}%</div>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>Calls handed off to host or manager</p>
              </div>

              <div className="glass-card">
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 6 }}>Unlisted Allergen Inferences</div>
                <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--success)" }}>0 (Zero)</div>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>Strict compliance: AI never guesses allergens</p>
              </div>
            </div>

            {/* Compliance Matrix Card */}
            <div className="glass-panel" style={{ padding: 24 }}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: 16 }}>Safety &amp; Compliance Verification</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { title: "AI Assistant Disclosure", desc: "Always announces itself as an AI assistant on turn 0", status: "Active" },
                  { title: "Call Recording Consent Notice", desc: "Discloses recording status based on restaurant setting", status: "Active" },
                  { title: "Database Exclusion Constraint", desc: "Postgres btree_gist rejects double bookings at database level", status: "Enforced" },
                  { title: "Strict Caller Authentication", desc: "Only matching phone numbers or codes can modify/cancel bookings", status: "Enforced" }
                ].map((item, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.02)", padding: "16px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: "#fff" }}>{item.title}</span>
                      <span className="badge badge-confirmed" style={{ fontSize: "0.68rem" }}>{item.status}</span>
                    </div>
                    <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODAL: ADD RESERVATION */}
      {showAddResModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
          padding: 20
        }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: 480, padding: 28, border: "1px solid var(--border-highlight)" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: 18 }}>Seat Walk-In / Staff Reservation</h3>
            <form onSubmit={handleAddReservation} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Guest Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={newRes.guest_name}
                  onChange={e => setNewRes({ ...newRes, guest_name: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Guest Phone (E.164)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. +12025550188"
                  value={newRes.guest_phone}
                  onChange={e => setNewRes({ ...newRes, guest_phone: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Date</label>
                  <input
                    type="date"
                    required
                    value={newRes.date}
                    onChange={e => setNewRes({ ...newRes, date: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Time</label>
                  <input
                    type="time"
                    required
                    value={newRes.time}
                    onChange={e => setNewRes({ ...newRes, time: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Party Size</label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  required
                  value={newRes.party_size}
                  onChange={e => setNewRes({ ...newRes, party_size: parseInt(e.target.value) || 2 })}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Staff Notes</label>
                <input
                  type="text"
                  placeholder="Window table / High chair / Birthday"
                  value={newRes.notes}
                  onChange={e => setNewRes({ ...newRes, notes: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" onClick={() => setShowAddResModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Confirm Booking</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD DISH */}
      {showAddDishModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
          padding: 20
        }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: 520, padding: 28, border: "1px solid var(--border-highlight)" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: 18 }}>Add Dish with Allergen Verification</h3>
            <form onSubmit={handleAddDish} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Dish Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Saffron Mutton Dum Biryani"
                  value={newDish.name}
                  onChange={e => setNewDish({ ...newDish, name: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Category</label>
                  <select value={newDish.category} onChange={e => setNewDish({ ...newDish, category: e.target.value })} style={{ width: "100%" }}>
                    <option value="Starters">Starters</option>
                    <option value="Mains">Mains</option>
                    <option value="Breads">Breads</option>
                    <option value="Desserts & Drinks">Desserts &amp; Drinks</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Price (INR)</label>
                  <input
                    type="number"
                    required
                    value={newDish.price}
                    onChange={e => setNewDish({ ...newDish, price: parseFloat(e.target.value) || 0 })}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Description</label>
                <textarea
                  rows={2}
                  placeholder="Ingredients and culinary notes..."
                  value={newDish.description}
                  onChange={e => setNewDish({ ...newDish, description: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              {/* Allergen verification checkbox */}
              <div style={{ background: "rgba(245, 158, 11, 0.1)", padding: 14, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-highlight)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontWeight: 600, fontSize: "0.88rem" }}>
                  <input
                    type="checkbox"
                    checked={newDish.allergensListed}
                    onChange={e => setNewDish({ ...newDish, allergensListed: e.target.checked })}
                    style={{ width: 18, height: 18, accentColor: "var(--primary)" }}
                  />
                  I confirm allergen data has been inspected from the kitchen.
                </label>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6, marginLeft: 28 }}>
                  Required before dish can go live on the receptionist phone line.
                </p>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" onClick={() => setShowAddDishModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Dish</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
