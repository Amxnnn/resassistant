"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  createAudioAnalyser,
  ParticipantKind,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant
} from "livekit-client";
import { playHangUp, primeCallSounds, startRingback } from "./call-sounds";

/*
 * A real browser call to the voice agent in agent/. The browser joins a LiveKit room with a token
 * from /api/livekit-token; the agent worker is dispatched into every new room, so it picks up,
 * speaks with its own voice (Deepgram Aura-2) and streams transcripts back.
 * Protocol names come from livekit-agents (types.py): lk.agent.state, lk.transcription, lk.chat.
 */

export type LivePhase = "idle" | "connecting" | "ringing" | "listening" | "thinking" | "speaking" | "ended";

export type Line = {
  id: string;
  speaker: "agent" | "caller";
  text: string;
  final: boolean;
  typed?: boolean;
  order: number;
};

const AGENT_STATE = "lk.agent.state";
const TOPIC_TRANSCRIPTION = "lk.transcription";
const TOPIC_CHAT = "lk.chat";
const SEGMENT_ID = "lk.segment_id";
const FINAL = "lk.transcription_final";
// How long to wait for the agent to join before telling the caller nobody picked up. LiveKit
// Cloud's free plan scales an idle agent to zero, and waking it takes 10-20 s; ringback covers it.
const PICKUP_TIMEOUT_MS = 45_000;

function isAgent(p: Participant) {
  return p.kind === ParticipantKind.AGENT || AGENT_STATE in p.attributes;
}

function phaseFromAgent(state: string | undefined): LivePhase {
  if (state === "speaking") return "speaking";
  if (state === "thinking") return "thinking";
  if (state === "listening") return "listening";
  return "ringing"; // initializing: joined, still loading the restaurant
}

export function useLiveCall({ callerName = "Website caller", onEnded }: { callerName?: string; onEnded?: () => void } = {}) {
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const room = useRef<Room | null>(null);
  const order = useRef(0);
  const agentLevel = useRef<() => number>(() => 0);
  const callerLevel = useRef<() => number>(() => 0);
  const cleanups = useRef<(() => void)[]>([]);
  const pickupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedCb = useRef(onEnded);
  endedCb.current = onEnded;

  // Stable getters for the face and the mic meter; they read whichever analyser is live.
  const getAgentLevel = useCallback(() => agentLevel.current(), []);
  const getCallerLevel = useCallback(() => callerLevel.current(), []);

  const upsert = useCallback((id: string, speaker: Line["speaker"], text: string, final: boolean, typed = false) => {
    setLines(prev => {
      const i = prev.findIndex(l => l.id === id);
      if (i === -1) return [...prev, { id, speaker, text, final, typed, order: order.current++ }];
      const next = prev.slice();
      next[i] = { ...next[i], text, final: final || next[i].final };
      return next;
    });
  }, []);

  const teardown = useCallback(() => {
    if (pickupTimer.current) clearTimeout(pickupTimer.current);
    pickupTimer.current = null;
    cleanups.current.forEach(fn => fn());
    cleanups.current = [];
    agentLevel.current = () => 0;
    callerLevel.current = () => 0;
    document.querySelectorAll("audio[data-live-call]").forEach(el => el.remove());
    setMicReady(false);
    setSoundBlocked(false);
  }, []);

  const end = useCallback(async () => {
    const r = room.current;
    room.current = null;
    teardown();
    setPhase(p => (p === "idle" ? p : "ended"));
    if (r && r.state !== ConnectionState.Disconnected) await r.disconnect();
  }, [teardown]);

  const start = useCallback(async () => {
    if (room.current) return;
    primeCallSounds(); // inside the click, so the browser lets the ringback play
    setError(null);
    setNotice(null);
    setLines([]);
    setElapsed(0);
    setMuted(false);
    setPhase("connecting");

    let token: string;
    let serverUrl: string;
    try {
      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: callerName })
      });
      const data = await res.json();
      if (!res.ok || data.mock || !data.token || !data.serverUrl) {
        setError("Live calls aren't set up on this server yet. It needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.");
        setPhase("idle");
        return;
      }
      token = data.token;
      serverUrl = data.serverUrl;
    } catch {
      setError("Couldn't reach the server to start the call. Check your connection and try again.");
      setPhase("idle");
      return;
    }

    const r = new Room({
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    room.current = r;

    const watchAgent = (p: Participant) => {
      if (!isAgent(p)) return;
      if (pickupTimer.current) clearTimeout(pickupTimer.current);
      pickupTimer.current = null;
      setStartedAt(s => s ?? Date.now());
      setPhase(phaseFromAgent(p.attributes[AGENT_STATE]));
    };

    r.on(RoomEvent.ParticipantConnected, watchAgent)
      .on(RoomEvent.ParticipantAttributesChanged, (_changed, p) => watchAgent(p))
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        if (isAgent(p) && room.current === r) {
          setNotice("The receptionist ended the call.");
          end();
        }
      })
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.liveCall = "1";
        document.body.appendChild(el);
        // The agent's voice is its microphone-source track; ambient and typing sounds come on another.
        if (isAgent(participant) && publication.source === Track.Source.Microphone) {
          const a = createAudioAnalyser(track as RemoteAudioTrack, { cloneTrack: true, fftSize: 512, smoothingTimeConstant: 0.5 });
          agentLevel.current = a.calculateVolume;
          cleanups.current.push(() => a.cleanup());
        }
      })
      .on(RoomEvent.TrackUnsubscribed, track => {
        track.detach().forEach(el => el.remove());
      })
      .on(RoomEvent.LocalTrackPublished, publication => {
        if (publication.source !== Track.Source.Microphone || !publication.track) return;
        const a = createAudioAnalyser(publication.track as LocalAudioTrack, { cloneTrack: true, fftSize: 512, smoothingTimeConstant: 0.6 });
        callerLevel.current = a.calculateVolume;
        cleanups.current.push(() => a.cleanup());
        setMicReady(true);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setSoundBlocked(!r.canPlaybackAudio))
      .on(RoomEvent.MediaDevicesError, () => {
        setNotice("Your microphone isn't available, so type instead. Check the browser's microphone permission to talk.");
      })
      .on(RoomEvent.Disconnected, () => {
        if (room.current === r) {
          room.current = null;
          teardown();
          setPhase("ended");
        }
        endedCb.current?.();
      });

    r.registerTextStreamHandler(TOPIC_TRANSCRIPTION, async (reader, participantInfo) => {
      const attrs = reader.info.attributes ?? {};
      const id = attrs[SEGMENT_ID] || reader.info.id;
      const speaker = participantInfo.identity === r.localParticipant.identity ? "caller" : "agent";
      let text = "";
      let cut = false;
      try {
        for await (const chunk of reader) {
          text += chunk;
          if (text.trim()) upsert(id, speaker, text, false);
        }
      } catch {
        // The room closed mid-line (a hang-up while the agent talks, or the agent dropped). The
        // reader throws DataStreamError; keep what arrived, as no more of this line will.
        cut = true;
      }
      if (text.trim()) upsert(id, speaker, text, cut || attrs[FINAL] === "true" || speaker === "agent");
    });

    try {
      await r.connect(serverUrl, token);
    } catch (err) {
      console.error("LiveKit connect failed:", err);
      room.current = null;
      setError("Couldn't connect the call. Try again in a moment.");
      setPhase("idle");
      return;
    }

    r.startAudio().catch(() => setSoundBlocked(true));
    try {
      await r.localParticipant.setMicrophoneEnabled(true);
    } catch {
      setNotice("Your microphone isn't available, so type instead. Check the browser's microphone permission to talk.");
    }

    const agent = Array.from(r.remoteParticipants.values()).find(isAgent);
    if (agent) watchAgent(agent);
    else {
      setPhase("ringing");
      pickupTimer.current = setTimeout(() => {
        if (room.current !== r) return;
        setError("Nobody picked up. The receptionist agent isn't running right now, so try again later.");
        end();
      }, PICKUP_TIMEOUT_MS);
    }
  }, [callerName, end, teardown, upsert]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      const r = room.current;
      if (!text || !r || r.state !== ConnectionState.Connected) return;
      upsert(`typed-${Date.now()}`, "caller", text, true, true);
      try {
        await r.localParticipant.sendText(text, { topic: TOPIC_CHAT });
      } catch {
        setNotice("That message didn't go through. Try again.");
      }
    },
    [upsert]
  );

  const toggleMute = useCallback(async () => {
    const r = room.current;
    if (!r) return;
    const next = !muted;
    try {
      await r.localParticipant.setMicrophoneEnabled(!next);
      setMuted(next);
    } catch {
      setNotice("Couldn't change the microphone.");
    }
  }, [muted]);

  const enableSound = useCallback(() => {
    room.current?.startAudio().then(() => setSoundBlocked(false));
  }, []);

  useEffect(() => {
    if (startedAt === null || phase === "idle" || phase === "ended" || phase === "connecting") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  useEffect(() => {
    if (phase === "connecting") setStartedAt(null);
  }, [phase]);

  // Ringback until the receptionist answers; a hang-up tone when a call that was answered ends.
  const stopRinging = useRef<(() => void) | null>(null);
  const answered = useRef(false);
  useEffect(() => {
    const ringing = phase === "connecting" || phase === "ringing";
    if (ringing && !stopRinging.current) stopRinging.current = startRingback();
    if (!ringing && stopRinging.current) {
      stopRinging.current();
      stopRinging.current = null;
    }
    if (phase === "listening" || phase === "thinking" || phase === "speaking") answered.current = true;
    if (phase === "ended" && answered.current) playHangUp();
    if (phase === "ended" || phase === "idle" || phase === "connecting") answered.current = false;
  }, [phase]);
  useEffect(() => () => stopRinging.current?.(), []);

  // Hang up if the page goes away mid-call.
  useEffect(() => {
    const leave = () => room.current?.disconnect();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
      teardown();
    };
  }, [teardown]);

  const sorted = [...lines].sort((a, b) => a.order - b.order);
  const live = phase === "ringing" || phase === "listening" || phase === "thinking" || phase === "speaking";

  return {
    phase,
    live,
    lines: sorted,
    error,
    notice,
    muted,
    micReady,
    soundBlocked,
    elapsed,
    start,
    end,
    send,
    toggleMute,
    enableSound,
    agentLevel: getAgentLevel,
    callerLevel: getCallerLevel
  };
}

export type LiveCall = ReturnType<typeof useLiveCall>;
