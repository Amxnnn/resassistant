import { NextResponse } from "next/server";
import { db } from "@/db";
import { menuItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import seedData from "@/db/seed-data.json";

export async function GET() {
  let list: any[] = [];
  if (db) {
    const rows = await db.select().from(menuItems);
    list = rows.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      price: Number(r.price),
      currency: "INR",
      dietaryTags: r.dietaryTags,
      spiceLevel: r.spiceLevel,
      allergensListed: r.allergensListed,
      allergens: r.allergens,
      availableToday: r.availableToday
    }));
  } else {
    list = seedData.menu;
  }
  return NextResponse.json({ items: list });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      category,
      description,
      price,
      dietaryTags = [],
      spiceLevel = "mild",
      allergensListed = false,
      allergens = [],
      availableToday = false,
      restaurantId = seedData.restaurant.id
    } = body;

    if (!name || !category || price === undefined) {
      return NextResponse.json({ error: "Name, category, and price are required." }, { status: 400 });
    }

    // Strict compliance rule: allergen fields must be listed before a dish goes live
    if (availableToday && !allergensListed) {
      return NextResponse.json(
        { error: "Compliance requirement: Allergen details must be explicitly verified and listed before a dish can be made available today." },
        { status: 422 }
      );
    }

    const id = crypto.randomUUID();
    if (db) {
      await db.insert(menuItems).values({
        id,
        restaurantId,
        name,
        category,
        description: description || null,
        price: String(price),
        dietaryTags,
        spiceLevel,
        allergensListed,
        allergens,
        availableToday
      });
    }

    return NextResponse.json({ id, name, category, price, availableToday }, { status: 201 });
  } catch (err: any) {
    console.error("Dashboard create menu item error:", err);
    return NextResponse.json({ error: err.message || "Failed to create menu item." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, price, availableToday, allergensListed, allergens, dietaryTags, spiceLevel, description } = body;

    if (!id) {
      return NextResponse.json({ error: "Menu item ID is required." }, { status: 400 });
    }

    if (availableToday && allergensListed === false) {
      return NextResponse.json(
        { error: "Compliance requirement: Allergen details must be confirmed before making a dish available today." },
        { status: 422 }
      );
    }

    if (db) {
      const updates: any = {};
      if (price !== undefined) updates.price = String(price);
      if (availableToday !== undefined) updates.availableToday = availableToday;
      if (allergensListed !== undefined) updates.allergensListed = allergensListed;
      if (allergens !== undefined) updates.allergens = allergens;
      if (dietaryTags !== undefined) updates.dietaryTags = dietaryTags;
      if (spiceLevel !== undefined) updates.spiceLevel = spiceLevel;
      if (description !== undefined) updates.description = description;

      await db.update(menuItems).set(updates).where(eq(menuItems.id, id));
    }

    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error("Dashboard update menu item error:", err);
    return NextResponse.json({ error: err.message || "Failed to update menu item." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Menu item ID is required." }, { status: 400 });

    if (db) {
      await db.delete(menuItems).where(eq(menuItems.id, id));
    }
    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error("Dashboard delete menu item error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete menu item." }, { status: 500 });
  }
}
