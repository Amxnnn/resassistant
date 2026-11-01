"use client";

// Call tones, made with Web Audio rather than shipped as files: a ringback while the call connects,
// and a short falling tone when it ends.

let ctx: AudioContext | null = null;

/** Create or wake the audio context. Call it from the click that starts the call, so the browser allows sound. */
export function primeCallSounds() {
  if (typeof window === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, freqs: number[], start: number, length: number, volume: number) {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.03);
  gain.gain.setValueAtTime(volume, start + length - 0.06);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(ac.destination);
  for (const f of freqs) {
    const osc = ac.createOscillator();
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + length);
  }
}

/** The ringback a caller hears while the other end rings: 440 + 480 Hz, two seconds on, three off. Returns stop. */
export function startRingback() {
  const ac = primeCallSounds();
  if (!ac) return () => {};
  const ring = () => tone(ac, [440, 480], ac.currentTime + 0.05, 2, 0.045);
  ring();
  const timer = setInterval(ring, 5000);
  return () => clearInterval(timer);
}

/** The end-of-call tone: three soft falling notes. */
export function playHangUp() {
  const ac = primeCallSounds();
  if (!ac) return;
  const t = ac.currentTime + 0.05;
  [620, 520, 420].forEach((f, i) => tone(ac, [f], t + i * 0.16, 0.14, 0.06));
}
