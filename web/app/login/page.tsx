"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AssistantFace } from "../_brand/assistant-face";
import { BRAND } from "../_brand/brand";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    // Dummy sign-in: any email and password works. Swap for Supabase auth later.
    await new Promise(r => setTimeout(r, 450));
    document.cookie = `${BRAND.sessionCookie}=demo; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next.startsWith("/dashboard") ? next : "/dashboard");
  }

  return (
    <div className="auth">
      <Link href="/" className="lp-logo auth-home">
        <AssistantFace size={28} label={BRAND.name} />
        <span>{BRAND.name}</span>
      </Link>

      <main className="auth-card">
        <AssistantFace
          size={88}
          state={busy ? "thinking" : peek ? "listening" : "idle"}
          followPointer={!peek}
          label={`${BRAND.name} receptionist`}
        />
        <h1 className="auth-title">Sign in to {BRAND.name}</h1>
        <p className="auth-sub">The staff dashboard for The Saffron Table.</p>

        <form onSubmit={submit} className="auth-form">
          <div className="group">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@restaurant.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type={peek ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Required"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button type="button" className="btn btn-quiet" onClick={() => setPeek(p => !p)} aria-pressed={peek}>
                {peek ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email.trim() || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-note">This is a demo sign-in: any email and password will work.</p>
      </main>

      <p className="auth-foot">
        Just looking? <Link href="/demo">Try the demo call</Link>
      </p>
    </div>
  );
}
