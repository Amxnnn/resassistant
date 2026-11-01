"use client";

import React, { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "../_brand/brand";
import { siteFonts } from "../_brand/fonts";
import { Orb } from "../_brand/orb";
import { SiteNav } from "../_brand/site-nav";

export function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(false);
  const [focused, setFocused] = useState(false);

  // The orb listens while you type: each keystroke is a small pulse that fades.
  const pulse = useRef(0);
  const typingLevel = useCallback(() => (pulse.current *= 0.92), []);
  const keystroke = () => {
    pulse.current = 0.09;
  };

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
    <div className={`site auth ${siteFonts}`}>
      <SiteNav page="auth" />
      <main className="auth-main">
        <Orb
          state={busy ? "thinking" : focused ? "listening" : "idle"}
          inputLevel={typingLevel}
          className="auth-orb"
          label={`${BRAND.name} receptionist`}
        />
        <h1 className="display-2 auth-title">Sign in to {BRAND.name}</h1>
        <p className="auth-sub">The staff dashboard for The Saffron Table.</p>

        <form
          onSubmit={submit}
          className="auth-form"
          onFocus={() => setFocused(true)}
          onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
          }}
        >
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@restaurant.com"
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                keystroke();
              }}
              required
              autoFocus
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type={peek ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Required"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                keystroke();
              }}
              required
            />
            <button
              type="button"
              className="auth-peek"
              onClick={() => setPeek(p => !p)}
              aria-pressed={peek}
              aria-label="Show password"
            >
              {peek ? "Hide" : "Show"}
            </button>
          </div>
          <button type="submit" className="pill pill-light pill-block" disabled={busy || !email.trim() || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-note">This is a demo sign-in: any email and password will work.</p>
      </main>
    </div>
  );
}
