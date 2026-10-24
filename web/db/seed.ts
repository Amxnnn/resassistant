import { writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { client, db } from "./index";
import {
  calls,
  callTurns,
  closures,
  infoEntries,
  menuItems,
  messages,
  openingHours,
  reservations,
  restaurants,
  restaurantTables,
} from "./schema";

dotenv.config({ path: ".env.local" });
dotenv.config();

const restaurantId = "6f1c2a9e-3b7d-4c5a-9e2f-1a8b7c6d5e4f";

export const seedRestaurant = {
  id: restaurantId,
  name: "The Saffron Table",
  phoneNumber: "+14155550123",
  timezone: "Asia/Kolkata",
  currency: "INR",
  languages: ["en", "hi"],
  greeting: "Thanks for calling The Saffron Table.",
  recordingEnabled: true,
  transferNumber: "+14155550199",
  phonePartyLimit: 8,
  seatingMinutes: 90,
  address: "12 Residency Road, near the Brigade Road junction, Bengaluru.",
  hoursSummary: "Open Tuesday to Sunday, 12 to 3 PM and 6 to 11 PM. Closed on Mondays.",
  policies: [
    "We hold tables for 15 minutes past the booking time.",
    "Parties of more than 8 are booked by the manager.",
    "For severe food allergies, please confirm with staff on arrival."
  ]
};

export const seedOpeningHours = [
  { weekday: 0, open: true, openTime: "12:00:00", closeTime: "23:00:00", lastSeating: "21:30" }, // Sunday
  { weekday: 1, open: false, openTime: null, closeTime: null, lastSeating: null },                 // Monday closed
  { weekday: 2, open: true, openTime: "12:00:00", closeTime: "23:00:00", lastSeating: "21:30" }, // Tuesday
  { weekday: 3, open: true, openTime: "12:00:00", closeTime: "23:00:00", lastSeating: "21:30" }, // Wednesday
  { weekday: 4, open: true, openTime: "12:00:00", closeTime: "23:00:00", lastSeating: "21:30" }, // Thursday
  { weekday: 5, open: true, openTime: "12:00:00", closeTime: "23:00:00", lastSeating: "21:30" }, // Friday
  { weekday: 6, open: true, openTime: "12:00:00", closeTime: "23:00:00", lastSeating: "21:30" }, // Saturday
];

export const seedClosures = [
  {
    id: "3c1a5d7e-9f0b-4a2c-8e4d-6b8a0c2e4f6a",
    restaurantId,
    date: "2026-11-10",
    reason: "Private Deepavali celebration for staff"
  }
];

export const seedTables = [
  { id: "00000000-0000-4000-8000-000000000001", label: "T1", capacity: 2 },
  { id: "00000000-0000-4000-8000-000000000002", label: "T2", capacity: 2 },
  { id: "00000000-0000-4000-8000-000000000003", label: "T3", capacity: 4 },
  { id: "00000000-0000-4000-8000-000000000004", label: "T4", capacity: 4 },
  { id: "00000000-0000-4000-8000-000000000005", label: "T5", capacity: 6 },
  { id: "00000000-0000-4000-8000-000000000006", label: "T6", capacity: 8 },
];

export const seedMenuItems = [
  // Starters
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Paneer Tikka",
    category: "Starters",
    description: "Chargrilled cottage cheese marinated in spiced yogurt and kasuri methi.",
    price: 360,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "medium",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Tandoori Malai Broccoli",
    category: "Starters",
    description: "Broccoli florets steeped in cream cheese, cardamom and toasted almonds.",
    price: 340,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "mild",
    allergensListed: true,
    allergens: ["dairy", "nuts"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Tandoori Chicken Tikka",
    category: "Starters",
    description: "Tender boneless chicken roasted with smoked Kashmiri chili and lemon.",
    price: 440,
    dietaryTags: ["gluten_free"],
    spiceLevel: "medium",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Amritsari Fish Crisps",
    category: "Starters",
    description: "Carom-seed and gram flour battered sea bass, served with mint chutney.",
    price: 490,
    dietaryTags: ["gluten_free", "dairy_free"],
    spiceLevel: "medium",
    allergensListed: true,
    allergens: ["fish"],
    availableToday: true
  },
  // Mains
  {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Chana Masala",
    category: "Mains",
    description: "Slow-simmered chickpeas in an onion, roasted cumin, and tomato gravy.",
    price: 350,
    dietaryTags: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
    spiceLevel: "medium",
    allergensListed: true,
    allergens: [],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    name: "Aloo Gobi",
    category: "Mains",
    description: "Potato and cauliflower toss-fried with ginger, turmeric, and fresh coriander.",
    price: 320,
    dietaryTags: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
    spiceLevel: "mild",
    allergensListed: true,
    allergens: [],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    name: "Dal Makhani",
    category: "Mains",
    description: "Black lentils simmered overnight on slow charcoal with churned butter and cream.",
    price: 390,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "mild",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    name: "Palak Paneer",
    category: "Mains",
    description: "Farm paneer cubes in velvety pureed spinach with roasted garlic and fenugreek.",
    price: 410,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "mild",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000009",
    name: "Butter Chicken",
    category: "Mains",
    description: "Old Delhi style tandoori chicken simmered in creamy satin tomato gravy with honey.",
    price: 520,
    dietaryTags: ["gluten_free"],
    spiceLevel: "mild",
    allergensListed: true,
    allergens: ["dairy", "nuts"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000010",
    name: "Chicken Korma",
    category: "Mains",
    description: "Royal Awadhi chicken simmered gently with brown onion and rich cashew paste.",
    price: 510,
    dietaryTags: ["gluten_free"],
    spiceLevel: "mild",
    allergensListed: true,
    allergens: ["dairy", "nuts"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000011",
    name: "Lamb Rogan Josh",
    category: "Mains",
    description: "Slow-braised lamb shanks with Kashmiri chili, rattan jot, and whole spices.",
    price: 580,
    dietaryTags: ["gluten_free", "dairy_free"],
    spiceLevel: "hot",
    allergensListed: true,
    allergens: [],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000012",
    name: "Vegetable Dum Biryani",
    category: "Mains",
    description: "Fragrant basmati rice layered with garden vegetables, saffron and fried mint.",
    price: 420,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "medium",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000013",
    name: "Dum Gosht Biryani",
    category: "Mains",
    description: "Long-grain basmati sealed in a handi with tender spiced mutton cuts and saffron.",
    price: 560,
    dietaryTags: ["gluten_free"],
    spiceLevel: "medium",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  },
  // Breads
  {
    id: "10000000-0000-4000-8000-000000000014",
    name: "Garlic Naan",
    category: "Breads",
    description: "Clay oven baked flatbread brushed with garlic butter and fresh coriander.",
    price: 110,
    dietaryTags: ["vegetarian"],
    spiceLevel: "none",
    allergensListed: true,
    allergens: ["gluten", "dairy"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000015",
    name: "Tandoori Roti",
    category: "Breads",
    description: "Whole-wheat flatbread cooked crisp against the tandoor clay wall.",
    price: 70,
    dietaryTags: ["vegetarian", "vegan", "dairy_free"],
    spiceLevel: "none",
    allergensListed: true,
    allergens: ["gluten"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000016",
    name: "Peshawari Naan",
    category: "Breads",
    description: "Tandoor bread stuffed with crushed almonds, raisins, coconut and cardamom.",
    price: 160,
    dietaryTags: ["vegetarian"],
    spiceLevel: "none",
    allergensListed: true,
    allergens: ["gluten", "dairy", "nuts"],
    availableToday: true
  },
  // Desserts & Drinks
  {
    id: "10000000-0000-4000-8000-000000000017",
    name: "Gulab Jamun",
    category: "Desserts & Drinks",
    description: "Warm golden milk dumplings soaked in green cardamom and rosewater syrup.",
    price: 180,
    dietaryTags: ["vegetarian"],
    spiceLevel: "none",
    allergensListed: true,
    allergens: ["dairy", "gluten", "nuts"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000018",
    name: "Kesar Phirni",
    category: "Desserts & Drinks",
    description: "Chilled ground rice pudding infused with saffron strands and slivered pistachios.",
    price: 210,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "none",
    allergensListed: true,
    allergens: ["dairy", "nuts"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000019",
    name: "Mango Lassi",
    category: "Desserts & Drinks",
    description: "Sweet churned curd blended with Alphonso mango pulp and saffron.",
    price: 160,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "none",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  },
  {
    id: "10000000-0000-4000-8000-000000000020",
    name: "Masala Chai",
    category: "Desserts & Drinks",
    description: "Assam CTC tea leaves brewed with ginger, crushed green cardamom and milk.",
    price: 90,
    dietaryTags: ["vegetarian", "gluten_free"],
    spiceLevel: "none",
    allergensListed: true,
    allergens: ["dairy"],
    availableToday: true
  }
];

export const seedInfoEntries = [
  { topic: "hours", language: "en", answer: "Open Tuesday to Sunday, 12 to 3 PM for lunch and 6 to 11 PM for dinner. We are closed on Mondays." },
  { topic: "hours", language: "hi", answer: "हम मंगलवार से रविवार दोपहर 12 से 3 बजे और शाम 6 से 11 बजे तक खुले हैं। सोमवार को बंद रहते हैं।" },
  { topic: "location", language: "en", answer: "12 Residency Road, right near the Brigade Road junction in central Bengaluru." },
  { topic: "location", language: "hi", answer: "12 रेजीडेंसी रोड, ब्रिगेड रोड जंक्शन के पास, बेंगलुरु।" },
  { topic: "parking", language: "en", answer: "There is complimentary valet parking right at our main entrance from 6 PM onwards, and a multi-level public parking lot 2 minutes away on Museum Road." },
  { topic: "parking", language: "hi", answer: "शाम 6 बजे से हमारे मुख्य प्रवेश द्वार पर मानार्थ वैले पार्किंग उपलब्ध है।" },
  { topic: "delivery", language: "en", answer: "We deliver across central Bengaluru on Swiggy and Zomato during our regular kitchen hours." },
  { topic: "delivery", language: "hi", answer: "हम स्विगी और जोमैटो पर हमारे किचन समय के दौरान डिलीवरी करते हैं।" },
  { topic: "specials", language: "en", answer: "Today's chef special is our seasonal Lucknowi Awadhi Thali with smoked Dal Makhani and Dum Biryani." },
  { topic: "specials", language: "hi", answer: "आज का स्पेशल शेफ लखनवी अवधी थाली है।" },
  { topic: "policies", language: "en", answer: "We hold tables for 15 minutes past the booking time. Parties of more than 8 guests are booked directly with the manager." },
  { topic: "policies", language: "hi", answer: "हम बुकिंग समय के 15 मिनट बाद तक टेबल रोकते हैं। 8 से अधिक मेहमानों की बुकिंग मैनेजर द्वारा की जाती है।" }
];

export const seedSampleReservations = [
  {
    id: "b3e1f0c2-7a4d-4e8b-9c1d-2f3a4b5c6d7e",
    restaurantId,
    tableId: "00000000-0000-4000-8000-000000000003", // T3 (4 top)
    guestName: "Asha Rao",
    guestPhone: "+12025550147",
    partySize: 4,
    start: new Date(Date.now() + 2 * 3600 * 1000), // In 2 hours
    end: new Date(Date.now() + 3.5 * 3600 * 1000),
    status: "confirmed" as const,
    code: "K7Q2",
    notes: "Window table if possible.",
    source: "phone",
    callId: "call_RM_7xQ2pL9a",
    idempotencyKey: "8d3f2b1a-6c4e-4f9a-b2d1-3e5c7a9b1d2f"
  },
  {
    id: "c4f2e1d3-8b5e-4f9c-0d2e-3a4b5c6d7e8f",
    restaurantId,
    tableId: "00000000-0000-4000-8000-000000000001", // T1 (2 top)
    guestName: "Vikram Sen",
    guestPhone: "+12025550188",
    partySize: 2,
    start: new Date(Date.now() + 4 * 3600 * 1000),
    end: new Date(Date.now() + 5.5 * 3600 * 1000),
    status: "confirmed" as const,
    code: "M4T8",
    notes: "Anniversary celebration",
    source: "phone",
    callId: "call_VS_3aK9mP1b",
    idempotencyKey: "7e2a1b9c-4d5f-4a6c-9e1b-3d5f7a9c1e2b"
  }
];

export const seedSampleMessages = [
  {
    id: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
    restaurantId,
    callerName: "Rohan Mehta",
    callerPhone: "+12025550163",
    topic: "large_party" as const,
    details: "Birthday dinner for 14 on Friday 13 November around 8 PM. Asked about a set menu and cake policy.",
    status: "new",
    callId: "call_RM_7xQ2pL9a"
  },
  {
    id: "8e7d6c5b-4a3d-4b2c-7d1e-0a9b8c7d6e5f",
    restaurantId,
    callerName: "Priya Sharma",
    callerPhone: "+12025550192",
    topic: "catering" as const,
    details: "Inquiring about corporate lunch buffet catering for 35 people next Thursday.",
    status: "in_progress",
    callId: "call_PS_2bJ8kQ0a"
  }
];

export const seedSampleCalls = [
  {
    id: "4d6f8a0c-2e4a-4c6e-9a1c-3e5a7c9e1b3d",
    restaurantId,
    callId: "call_RM_7xQ2pL9a",
    channel: "phone" as const,
    callerNumber: "+12025550147",
    dialedNumber: "+14155550123",
    startedAt: new Date(Date.now() - 3600 * 1000),
    endedAt: new Date(Date.now() - 3450 * 1000),
    language: "en",
    outcome: "booked" as const,
    recordingUrl: null,
    turns: [
      {
        index: 0,
        speaker: "agent",
        text: "Thanks for calling The Saffron Table. I'm the restaurant's AI assistant. How can I help you today?",
        at: new Date(Date.now() - 3600 * 1000),
        interrupted: false,
        latency: null
      },
      {
        index: 1,
        speaker: "caller",
        text: "Hi! I'd like to book a table for four this evening at 7:30 PM under Asha Rao.",
        at: new Date(Date.now() - 3585 * 1000),
        interrupted: false,
        latency: null
      },
      {
        index: 2,
        speaker: "agent",
        text: "Let me check availability for four. Yes, 7:30 PM is available for 4. Shall I confirm this booking for Asha Rao?",
        at: new Date(Date.now() - 3580 * 1000),
        interrupted: false,
        latency: {
          eou_ms: 205,
          stt_ms: 135,
          llm_ttft_ms: 395,
          tts_ttfb_ms: 92,
          total_ms: 692,
          llm_model: "gemini-2.5-flash"
        }
      },
      {
        index: 3,
        speaker: "caller",
        text: "Yes please, window table if possible.",
        at: new Date(Date.now() - 3570 * 1000),
        interrupted: false,
        latency: null
      },
      {
        index: 4,
        speaker: "agent",
        text: "You're all set! Table for 4, tonight at 7:30 PM. Your booking code is K7Q2. We look forward to welcoming you!",
        at: new Date(Date.now() - 3565 * 1000),
        interrupted: false,
        latency: {
          eou_ms: 198,
          stt_ms: 128,
          llm_ttft_ms: 380,
          tts_ttfb_ms: 88,
          total_ms: 666,
          llm_model: "gemini-2.5-flash"
        }
      }
    ]
  }
];

async function main() {
  const seedBundle = {
    restaurant: seedRestaurant,
    opening_hours: seedOpeningHours,
    closures: seedClosures,
    tables: seedTables,
    menu: seedMenuItems,
    info_entries: seedInfoEntries,
    reservations: seedSampleReservations,
    messages: seedSampleMessages,
    calls: seedSampleCalls
  };

  await writeFile("db/seed-data.json", JSON.stringify(seedBundle, null, 2));
  console.log("Deterministic seed-data.json written successfully.");

  if (!db || !client) {
    console.log("DATABASE_URL is not set; running with deterministic seed bundle.");
    return;
  }

  console.log("Inserting seed data into Supabase Postgres database...");

  // Insert restaurant
  await db.insert(restaurants).values(seedRestaurant).onConflictDoNothing();

  // Insert opening hours
  await db.insert(openingHours).values(
    seedOpeningHours.map((h) => ({
      restaurantId,
      weekday: h.weekday,
      open: h.open,
      openTime: h.openTime,
      closeTime: h.closeTime,
      lastSeating: h.lastSeating
    }))
  ).onConflictDoNothing();

  // Insert closures
  await db.insert(closures).values(seedClosures).onConflictDoNothing();

  // Insert tables
  await db.insert(restaurantTables).values(
    seedTables.map((t) => ({ ...t, restaurantId }))
  ).onConflictDoNothing();

  // Insert menu
  await db.insert(menuItems).values(
    seedMenuItems.map((item) => ({
      id: item.id,
      restaurantId,
      name: item.name,
      category: item.category,
      description: item.description,
      price: String(item.price),
      dietaryTags: item.dietaryTags,
      spiceLevel: item.spiceLevel,
      allergensListed: item.allergensListed,
      allergens: item.allergens,
      availableToday: item.availableToday
    }))
  ).onConflictDoNothing();

  // Insert info entries
  await db.insert(infoEntries).values(
    seedInfoEntries.map((info) => ({
      restaurantId,
      topic: info.topic,
      answer: info.answer,
      language: info.language
    }))
  ).onConflictDoNothing();

  // Insert sample reservations
  for (const res of seedSampleReservations) {
    await db.insert(reservations).values(res).onConflictDoNothing();
  }

  // Insert sample messages
  for (const msg of seedSampleMessages) {
    await db.insert(messages).values(msg).onConflictDoNothing();
  }

  // Insert sample calls
  for (const call of seedSampleCalls) {
    await db.insert(calls).values({
      id: call.id,
      restaurantId: call.restaurantId,
      callId: call.callId,
      channel: call.channel,
      callerNumber: call.callerNumber,
      dialedNumber: call.dialedNumber,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      language: call.language,
      outcome: call.outcome,
      recordingUrl: call.recordingUrl
    }).onConflictDoNothing();

    for (const turn of call.turns) {
      await db.insert(callTurns).values({
        callId: call.id,
        index: turn.index,
        speaker: turn.speaker,
        text: turn.text,
        at: turn.at,
        interrupted: turn.interrupted,
        latency: turn.latency
      }).onConflictDoNothing();
    }
  }

  console.log("Database seeded successfully with restaurant, hours, tables, menu, reservations, messages, and calls!");
}

main()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (client) {
      await client.end();
    }
    process.exit(process.exitCode || 0);
  });
