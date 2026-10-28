import type { Call, Turn } from "./types";

// Sample calls for the public demo dashboard: the Calls screen, the call sheets and Insights.
// Guests, numbers and timings are made up.

type Line = { who: "agent" | "caller"; text: string; ms?: number };

type Sample = {
  minutesAgo: number;
  caller: string | null;
  outcome: string;
  model: string;
  lines: Line[];
};

const GREETING = "Thanks for calling The Saffron Table. I'm the restaurant's AI assistant. How can I help?";

const SAMPLES: Sample[] = [
  {
    minutesAgo: 18,
    caller: "+12025550147",
    outcome: "booked",
    model: "openai/gpt-oss-120b",
    lines: [
      { who: "agent", text: GREETING },
      { who: "caller", text: "Hi! Do you have a table for four tonight, around eight?" },
      { who: "agent", text: "Eight's taken, but seven forty-five and eight thirty are free. Which would you like?", ms: 742 },
      { who: "caller", text: "Eight thirty, please. It's under Priya." },
      { who: "agent", text: "Just to confirm: table for 4, tonight at 8:30 PM, for Priya. Is that right?", ms: 655 },
      { who: "caller", text: "Yes, that's right." },
      { who: "agent", text: "You're booked. Your code is K 7 Q 2. Anything else I can help with?", ms: 811 },
      { who: "caller", text: "No, that's all. Thanks!" },
      { who: "agent", text: "Thanks for calling, and we'll see you tonight! Goodbye.", ms: 590 }
    ]
  },
  {
    minutesAgo: 52,
    caller: "+14155550163",
    outcome: "answered",
    model: "openai/gpt-oss-120b",
    lines: [
      { who: "agent", text: GREETING },
      { who: "caller", text: "Is there parking near you?" },
      { who: "agent", text: "There's free valet at the main entrance from 6 PM, and a public car park on Museum Road, two minutes away.", ms: 698 },
      { who: "caller", text: "Great. And what do you have that's vegan?" },
      { who: "agent", text: "Chana masala, aloo gobi and the tandoori roti are vegan. Would you like to hear more?", ms: 876 },
      { who: "caller", text: "That's enough, thank you. Bye!" },
      { who: "agent", text: "Thanks for calling The Saffron Table. Take care, goodbye!", ms: 612 }
    ]
  },
  {
    minutesAgo: 131,
    caller: "+16465550191",
    outcome: "changed",
    model: "gemini-3.5-flash-lite",
    lines: [
      { who: "agent", text: GREETING },
      { who: "caller", text: "I need to move my booking on Saturday to a bit later." },
      { who: "agent", text: "Sure. What's your booking code?", ms: 702 },
      { who: "caller", text: "M 4 R 8." },
      { who: "agent", text: "Got it, Saturday at 7:30 PM for 2. What time would you like instead?", ms: 934 },
      { who: "caller", text: "Quarter past eight." },
      { who: "agent", text: "Just to confirm: Saturday at 8:15 PM for 2. Is that right?", ms: 1022 },
      { who: "caller", text: "Yes." },
      { who: "agent", text: "Done, your table is now at 8:15 PM. Anything else I can help with?", ms: 768 },
      { who: "caller", text: "No." },
      { who: "agent", text: "Thanks for calling, and we'll see you on Saturday! Goodbye.", ms: 571 }
    ]
  },
  {
    minutesAgo: 186,
    caller: "+13125550128",
    outcome: "message_taken",
    model: "openai/gpt-oss-120b",
    lines: [
      { who: "agent", text: GREETING },
      { who: "caller", text: "We're a group of fourteen for a birthday on Friday. Can we book the private room?" },
      { who: "agent", text: "Bookings over eight are handled by the manager. Can I take a message so they call you back?", ms: 788 },
      { who: "caller", text: "Yes please. It's Rohan, around 8 PM, fourteen people." },
      { who: "agent", text: "I've passed that to the manager: Rohan, 14 guests, Friday around 8 PM, private room. Anything else?", ms: 1105 },
      { who: "caller", text: "That's it, thanks." },
      { who: "agent", text: "Thanks for calling The Saffron Table. Take care, goodbye!", ms: 604 }
    ]
  },
  {
    minutesAgo: 1460,
    caller: "+12135550110",
    outcome: "transferred",
    model: "gemini-3.5-flash-lite",
    lines: [
      { who: "agent", text: GREETING },
      { who: "caller", text: "Can I speak to a person about a dish I had last night?" },
      { who: "agent", text: "Of course. Putting you through to the host now.", ms: 865 }
    ]
  },
  {
    minutesAgo: 1525,
    caller: "+17185550134",
    outcome: "hung_up",
    model: "openai/gpt-oss-120b",
    lines: [
      { who: "agent", text: GREETING },
      { who: "caller", text: "Do you take bookings for Sunday lunch?" },
      { who: "agent", text: "Yes, we're open for lunch on Sunday from 12 to 3 PM. How many people, and what time?", ms: 721 },
      { who: "caller", text: "Actually, let me check with my family first." }
    ]
  }
];

/** A small seeded random source, so the sample data comes out the same on every visit. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits a reply time into its stages the way real turns are timed: speech to text runs inside
 *  turn detection, and what the stages don't cover is network and tool time. */
function latency(total: number, model: string, rand: () => number): Turn["latency"] {
  const tts = Math.round(88 + rand() * 60);
  const other = Math.round(30 + rand() * 70);
  const eou = Math.round(Math.min(total * (0.24 + rand() * 0.1), total - tts - other - 120));
  const stt = Math.round(eou * (0.5 + rand() * 0.25));
  const llm = total - eou - tts - other;
  return { eou_ms: eou, stt_ms: stt, llm_ttft_ms: llm, tts_ttfb_ms: tts, total_ms: total, llm_model: model };
}

/** A reply time drawn stage by stage; now and then a slow one, as when a lookup runs long. */
function replyTime(model: string, rand: () => number) {
  const eou = 150 + rand() * 140;
  const llm = (model.startsWith("gemini") ? 340 : 250) + rand() * (model.startsWith("gemini") ? 300 : 230);
  const slow = rand() < 0.06 ? 500 + rand() * 1100 : 0;
  return Math.round(eou + llm + slow + 85 + rand() * 55 + 25 + rand() * 60);
}

function toCall(s: Sample, id: string, start: number, rand: () => number, retime: boolean): Call {
  const turns: Turn[] = s.lines.map((l, index) => {
    const ms = l.ms && retime ? replyTime(s.model, rand) : l.ms;
    return {
      index,
      speaker: l.who,
      text: l.text,
      at: new Date(start + index * 7_000).toISOString(),
      interrupted: false,
      latency: ms ? latency(ms, s.model, rand) : null
    };
  });
  return {
    id: `sample-${id}`,
    callId: `call_sample_${id}`,
    channel: "phone",
    callerNumber: s.caller,
    dialedNumber: "+14155550123",
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + s.lines.length * 7_000 + 4_000).toISOString(),
    language: "en",
    outcome: s.outcome,
    recordingUrl: null,
    turns
  };
}

// How often each kind of call comes in, for the two weeks of history behind the scripted calls.
const MIX: [number, number][] = [
  [0, 0.42], // booked
  [1, 0.3], // answered
  [2, 0.08], // changed
  [3, 0.08], // message taken
  [4, 0.04], // transferred
  [5, 0.08] // hung up
];

/** The scripted calls (the last day or so), then two weeks of earlier calls in the same shapes,
 *  closed Mondays skipped. Every name, number and timing is made up. */
export function sampleCalls(now: Date): Call[] {
  const rand = seeded(20261028);
  const scripted = SAMPLES.map((s, i) => toCall(s, String(i + 1), now.getTime() - s.minutesAgo * 60_000, rand, false));
  const history: Call[] = [];
  const day = 86_400_000;
  for (let d = 2; d <= 14; d++) {
    const date = new Date(now.getTime() - d * day);
    if (new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(date) === "Mon") continue;
    const count = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      let pick = rand();
      const [template] = MIX.find(([, p]) => (pick -= p) < 0) ?? MIX[0];
      const s = SAMPLES[template];
      const caller = `+1${["202", "415", "646", "312", "213", "718"][Math.floor(rand() * 6)]}555${String(100 + Math.floor(rand() * 900)).padStart(4, "0")}`;
      const start = date.getTime() - (2 + rand() * 9) * 3_600_000;
      history.push(toCall({ ...s, caller }, `h${d}-${k}`, start, rand, true));
    }
  }
  return [...scripted, ...history];
}
