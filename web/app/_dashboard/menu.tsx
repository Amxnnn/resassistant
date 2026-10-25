"use client";

import React, { useState } from "react";
import { CircleAlert, Plus, Search } from "lucide-react";
import type { Dish, SheetState } from "./types";
import { DIETARY_LABEL, plural, titleCase } from "./format";
import { Empty, PageHead, Section, Segmented, SkeletonRows, Switch } from "./ui";

export function formatPrice(price: number) {
  return `₹${Number(price).toLocaleString("en-IN")}`;
}

export function dishCategories(menu: Dish[]) {
  return Array.from(new Set(menu.map(d => d.category)));
}

export function allergenLine(d: Dish) {
  if (!d.allergensListed) return null;
  return d.allergens && d.allergens.length ? `Contains ${d.allergens.join(", ")}` : "No listed allergens";
}

export function Menu({
  menu,
  loading,
  onOpen,
  onToggle
}: {
  menu: Dish[];
  loading: boolean;
  onOpen: (sheet: SheetState) => void;
  onToggle: (dish: Dish) => void;
}) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const categories = dishCategories(menu);
  const live = menu.filter(d => d.availableToday).length;
  const missing = menu.filter(d => !d.allergensListed);

  const q = query.trim().toLowerCase();
  const visible = menu.filter(
    d =>
      (category === "all" || d.category === category) &&
      (!q || d.name.toLowerCase().includes(q) || (d.description || "").toLowerCase().includes(q))
  );

  return (
    <div className="page">
      <PageHead
        title="Menu"
        sub={
          loading
            ? "Dishes, prices and allergens the receptionist answers from."
            : `${plural(menu.length, "dish", "dishes")} · ${live} on today's menu. The receptionist only answers allergen questions from what's listed here.`
        }
        action={
          <button type="button" className="btn btn-primary" onClick={() => onOpen({ kind: "dish" })}>
            <Plus size={16} strokeWidth={2.4} /> New dish
          </button>
        }
      />

      {!loading && missing.length > 0 && (
        <div className="notice" role="note">
          <CircleAlert size={18} />
          <span>
            {plural(missing.length, "dish", "dishes")} can't go on today's menu until the allergens are confirmed with the kitchen.
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => onOpen({ kind: "dish", id: missing[0].id })}>
            Review
          </button>
        </div>
      )}

      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search dishes</span>
          <input type="search" placeholder="Search dishes" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <Segmented
          label="Category"
          value={category}
          onChange={setCategory}
          options={[{ id: "all", label: "All" }, ...categories.map(c => ({ id: c, label: c }))]}
        />
      </div>

      {loading ? (
        <SkeletonRows count={6} />
      ) : visible.length === 0 ? (
        <div className="group">
          {q ? (
            <Empty title="No matches" body={`No dishes match "${query.trim()}".`} />
          ) : (
            <Empty
              title="No dishes yet"
              body="Add the menu so the receptionist can answer questions about dishes, prices and allergens."
            />
          )}
        </div>
      ) : (
        categories
          .filter(c => visible.some(d => d.category === c))
          .map(c => {
            const items = visible.filter(d => d.category === c);
            return (
              <Section key={c} title={c} meta={`${items.filter(d => d.availableToday).length} of ${items.length} on today's menu`}>
                <div className="group">
                  {items.map(d => (
                    <DishRow key={d.id} d={d} onOpen={onOpen} onToggle={onToggle} />
                  ))}
                </div>
              </Section>
            );
          })
      )}
    </div>
  );
}

function DishRow({ d, onOpen, onToggle }: { d: Dish; onOpen: (sheet: SheetState) => void; onToggle: (dish: Dish) => void }) {
  const tags = [
    ...(d.dietaryTags || []).map(t => DIETARY_LABEL[t] || titleCase(t)),
    d.spiceLevel && d.spiceLevel !== "none" ? `${titleCase(d.spiceLevel)} spice` : null
  ].filter(Boolean);
  const allergens = allergenLine(d);

  return (
    <div className={`row${d.availableToday ? "" : " is-off"}`}>
      <button type="button" className="row-link" onClick={() => onOpen({ kind: "dish", id: d.id })}>
        <span className="row-title" style={{ display: "block" }}>
          {d.name}
        </span>
        {d.description && (
          <span className="row-sub" style={{ display: "block" }}>
            {d.description}
          </span>
        )}
        <span className="row-sub" style={{ display: "block", color: "var(--label-3)" }}>
          {tags.length > 0 && <>{tags.join(" · ")} · </>}
          {allergens ? allergens : <span className="text-red" style={{ fontWeight: 500 }}>Allergens not confirmed</span>}
        </span>
      </button>
      <span className="row-trail">
        <span className="num" style={{ color: "var(--label)", fontWeight: 500, minWidth: 48, textAlign: "right" }}>
          {formatPrice(d.price)}
        </span>
        <Switch
          checked={d.availableToday}
          onChange={() => onToggle(d)}
          disabled={!d.availableToday && !d.allergensListed}
          label={`${d.name} on today's menu`}
        />
      </span>
    </div>
  );
}
