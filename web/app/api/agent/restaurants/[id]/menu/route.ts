import { NextResponse } from "next/server";
import { error, requireAgentKey } from "@/lib/agent-api";
import { db } from "@/db";
import { menuItems, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAgentKey(request);
  if (denied) return denied;

  const restaurantId = (await params).id;
  const url = new URL(request.url);
  const query = url.searchParams.get("query")?.toLowerCase().trim() || null;
  const dietaryFilters = url.searchParams.getAll("dietary").flatMap(d => d.split(",")).map(d => d.trim().toLowerCase()).filter(Boolean);
  const limitParam = parseInt(url.searchParams.get("limit") || "5", 10);
  const limit = isNaN(limitParam) ? 5 : Math.min(Math.max(limitParam, 1), 20);

  // Check restaurant exists
  let restaurantExists = false;
  if (db) {
    const res = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (res.length > 0) restaurantExists = true;
  }
  if (!restaurantExists && restaurantId === seedData.restaurant.id) {
    restaurantExists = true;
  }
  if (!restaurantExists) {
    return error("not_found", "I couldn't find that restaurant.", 404);
  }

  let allDishes: any[] = [];
  if (db) {
    const rows = await db.select().from(menuItems).where(eq(menuItems.restaurantId, restaurantId));
    allDishes = rows.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      price: Number(r.price),
      currency: "INR",
      dietary_tags: r.dietaryTags,
      spice_level: r.spiceLevel,
      allergens_listed: r.allergensListed,
      allergens: r.allergens,
      available_today: r.availableToday
    }));
  } else {
    allDishes = (seedData.menu as any[]).map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      price: Number(r.price),
      currency: r.currency || "INR",
      dietary_tags: r.dietary_tags || r.dietaryTags || [],
      spice_level: r.spice_level || r.spiceLevel || null,
      allergens_listed: r.allergens_listed ?? r.allergensListed ?? true,
      allergens: r.allergens || [],
      available_today: r.available_today ?? r.availableToday ?? true
    }));
  }

  // Filter dishes
  let filtered = allDishes;

  if (query) {
    filtered = filtered.filter(item => {
      const haystack = `${item.name} ${item.category} ${item.description || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  if (dietaryFilters.length > 0) {
    filtered = filtered.filter(item => {
      const tags = (item.dietary_tags || []).map((t: string) => t.toLowerCase());
      return dietaryFilters.every(f => tags.includes(f));
    });
  }

  const items = filtered.slice(0, limit);

  // Build speakable summary
  let summary = "";
  if (items.length === 0) {
    summary = query
      ? `I couldn't find any menu items matching "${query}".`
      : "I couldn't find matching dishes with those dietary requirements.";
  } else {
    const descriptions = items.map(i => {
      const spiceText = i.spice_level && i.spice_level !== "none" ? `, ${i.spice_level} spicy` : "";
      return `${i.name}, ${i.price} rupees${spiceText}`;
    });

    const unlistedAllergens = items.filter(i => !i.allergens_listed);
    let allergenNote = "";
    if (unlistedAllergens.length > 0) {
      const names = unlistedAllergens.map(i => i.name).join(" and ");
      allergenNote = ` Allergens for ${names} are not listed.`;
    }

    if (items.length === 1) {
      summary = `We have ${descriptions[0]}.${allergenNote}`;
    } else {
      summary = `We have ${items.length} options: ${descriptions.join(". ")}.${allergenNote}`;
    }
  }

  return NextResponse.json({
    items,
    summary
  });
}
