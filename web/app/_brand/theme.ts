"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, THEME_META } from "./theme-boot";

export type Theme = "light" | "dark";

export function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Calls back on every change of theme, from the switch or the device. Returns the unsubscribe. */
export function subscribeTheme(callback: (theme: Theme) => void) {
  const watcher = new MutationObserver(() => callback(readTheme()));
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => watcher.disconnect();
}

/** The visitor's choice: remembered, and cross-faded where the browser can (the switch keeps its own slide). */
export function chooseTheme(next: Theme) {
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // private mode: the choice holds for this page only
  }
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = next;
    document.querySelectorAll('meta[name="theme-color"]').forEach(e => e.setAttribute("content", THEME_META[next]));
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("startViewTransition" in document)) return apply();
  document.startViewTransition(apply);
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(readTheme());
    return subscribeTheme(setTheme);
  }, []);
  return theme;
}
