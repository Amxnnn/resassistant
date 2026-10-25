"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, CircleAlert, Minus, Plus } from "lucide-react";

/* ---------- Sheet: slides in from the right, rises from the bottom on a phone ---------- */

export function Sheet({
  title,
  closing,
  onRequestClose,
  onExited,
  lead,
  trail,
  children
}: {
  title: string;
  closing: boolean;
  onRequestClose: () => void;
  onExited: () => void;
  lead?: React.ReactNode;
  trail?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const requestClose = useRef(onRequestClose);
  requestClose.current = onRequestClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose.current();
      }
      if (e.key === "Tab" && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <>
      <div className={`sheet-scrim${closing ? " is-closing" : ""}`} onClick={onRequestClose} aria-hidden="true" />
      <div
        ref={ref}
        className={`sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onAnimationEnd={e => {
          if (closing && e.target === e.currentTarget) onExited();
        }}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-head-lead">{lead}</div>
          <div className="sheet-head-title">{title}</div>
          <div className="sheet-head-trail">{trail}</div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

export function SheetAction({
  children,
  onClick,
  strong,
  disabled,
  type = "button",
  form
}: {
  children: React.ReactNode;
  onClick?: () => void;
  strong?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
}) {
  return (
    <button type={type} form={form} className={`sheet-action${strong ? " is-strong" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/* ---------- Segmented control with a sliding thumb ---------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: { id: T; label: React.ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  function measure() {
    const el = buttons.current[value];
    if (!el) return;
    const next = { x: el.offsetLeft, w: el.offsetWidth };
    setThumb(prev => (prev && prev.x === next.x && prev.w === next.w ? prev : next));
  }

  useLayoutEffect(measure);

  useEffect(() => {
    if (!wrap.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap.current);
    return () => ro.disconnect();
  });

  return (
    <div className="segmented-wrap">
      <div ref={wrap} className="segmented" role="group" aria-label={label}>
        {thumb && <span className="segmented-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} aria-hidden="true" />}
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            ref={el => {
              buttons.current[o.id] = el;
            }}
            aria-pressed={o.id === value}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Switch, stepper, chips ---------- */

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={e => {
        e.stopPropagation();
        onChange(!checked);
      }}
    />
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={16} strokeWidth={2.25} />
      </button>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={16} strokeWidth={2.25} />
      </button>
    </div>
  );
}

export function ChipToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------- Building blocks ---------- */

export function Section({
  title,
  meta,
  action,
  children,
  foot
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <section className="section">
      {(title || meta || action) && (
        <div className="section-head">
          {title && <h2 className="section-title">{title}</h2>}
          {(meta || action) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {meta && <span className="section-meta">{meta}</span>}
              {action}
            </div>
          )}
        </div>
      )}
      {children}
      {foot && <p className="section-foot">{foot}</p>}
    </section>
  );
}

export function PageHead({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="large-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

export function Status({ dot, children }: { dot?: string; children: React.ReactNode }) {
  return (
    <span className="status">
      <span className={`dot ${dot || ""}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Chevron() {
  return <ChevronRight size={16} className="row-chevron" aria-hidden="true" />;
}

export function Empty({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="group" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="row">
          <div className="row-main">
            <span className="skeleton" style={{ width: `${46 - i * 6}%` }} />
            <span className="skeleton" style={{ width: `${28 + i * 5}%`, marginTop: 8, height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Toast({ message, tone }: { message: string; tone: "ok" | "error" }) {
  return (
    <div className={`toast${tone === "error" ? " is-error" : ""}`} role="status" aria-live="polite">
      {tone === "error" ? <CircleAlert size={17} /> : <Check size={17} />}
      {message}
    </div>
  );
}
