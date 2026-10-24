import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import seedData from "@/db/seed-data.json";

export async function GET(request: Request) {
  return handleTokenRequest(request);
}

export async function POST(request: Request) {
  return handleTokenRequest(request);
}

async function handleTokenRequest(request: Request) {
  const url = new URL(request.url);
  let roomName = url.searchParams.get("room");
  let identity = url.searchParams.get("identity");
  let participantName = url.searchParams.get("name") || "Browser Test Caller";

  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (body.room) roomName = body.room;
      if (body.identity) identity = body.identity;
      if (body.name) participantName = body.name;
    } catch {
      // Use query params if body parsing fails
    }
  }

  if (!roomName) {
    roomName = `test-call-${Math.random().toString(36).substring(2, 8)}`;
  }
  if (!identity) {
    identity = `guest-${Math.random().toString(36).substring(2, 8)}`;
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  const restaurantPhone = (seedData.restaurant as any).phoneNumber || (seedData.restaurant as any).phone_number || "+14155550123";

  if (!apiKey || !apiSecret) {
    // If LiveKit credentials are not yet set, provide deterministic test credentials
    return NextResponse.json({
      token: `demo_token_${identity}_${Date.now()}`,
      room: roomName,
      identity,
      serverUrl: livekitUrl || "wss://demo.livekit.cloud",
      restaurant_phone: restaurantPhone,
      mock: true,
      message: "LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set in .env.local. Running in browser simulation mode."
    });
  }

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: participantName,
      attributes: {
        restaurant_phone: restaurantPhone
      }
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const token = await at.toJwt();

    return NextResponse.json({
      token,
      room: roomName,
      identity,
      serverUrl: livekitUrl || "",
      restaurant_phone: restaurantPhone,
      mock: false
    });
  } catch (err: any) {
    console.error("LiveKit token generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate LiveKit access token." },
      { status: 500 }
    );
  }
}
