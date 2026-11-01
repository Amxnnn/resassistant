"use client";

import { Moon, Sun } from "lucide-react";
import { chooseTheme, useTheme } from "./theme";

/**
 * An iOS switch for the appearance: the knob carries the sun or the moon across the track.
 * Its position comes from <html data-theme> in CSS, so it is right before React hydrates.
 */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`theme-switch ${className}`}
      onClick={() => chooseTheme(dark ? "light" : "dark")}
    >
      <span className="theme-switch-knob" aria-hidden="true">
        <Sun className="theme-switch-sun" size={14} strokeWidth={2.2} />
        <Moon className="theme-switch-moon" size={13} strokeWidth={2.2} />
      </span>
    </button>
  );
}
