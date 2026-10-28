"use client";

import React, { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const STATE_WORD: Record<OrbState, string> = {
  idle: "waiting",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking"
};

// How the sphere carries itself in each state. GSAP eases between them.
type Look = { amp: number; freq: number; speed: number; scale: number; swirl: number; fray: number; spin: number };

const LOOKS: Record<OrbState, Look> = {
  idle: { amp: 0.07, freq: 1.5, speed: 0.32, scale: 1, swirl: 0, fray: 0.55, spin: 0.08 },
  listening: { amp: 0.045, freq: 1.9, speed: 0.45, scale: 0.93, swirl: 0, fray: 0.35, spin: 0.05 },
  thinking: { amp: 0.1, freq: 2.6, speed: 1.15, scale: 0.97, swirl: 1, fray: 0.8, spin: 0.34 },
  speaking: { amp: 0.08, freq: 1.7, speed: 0.6, scale: 1, swirl: 0, fray: 1, spin: 0.12 }
};

/** A stand-in voice: syllable-like pulses, re-targeted every 80–170 ms. Returns a level getter (0–1). */
export function speechEnvelope() {
  let value = 0;
  let next = 0;
  return () => {
    const now = performance.now();
    if (now > next) {
      value = Math.random() < 0.16 ? 0.02 : 0.05 + Math.random() * 0.13;
      next = now + 80 + Math.random() * 90;
    }
    return value;
  };
}

/* Simplex 3D noise by Ian McEwan, Ashima Arts (MIT licence). */
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uClock;
uniform float uAmp;
uniform float uFreq;
uniform float uScale;
uniform float uSwirl;
uniform float uFray;
uniform float uLevel;
uniform float uSize;
uniform float uPixelRatio;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
${NOISE}

// Warm at the base, cool at the crown, like the reference sphere.
vec3 palette(float h) {
  vec3 amber = vec3(1.0, 0.71, 0.45);
  vec3 ember = vec3(0.95, 0.37, 0.16);
  vec3 rose = vec3(0.74, 0.22, 0.44);
  vec3 iris = vec3(0.38, 0.43, 0.96);
  vec3 c = mix(amber, ember, smoothstep(0.0, 0.3, h));
  c = mix(c, rose, smoothstep(0.32, 0.68, h));
  return mix(c, iris, smoothstep(0.68, 1.0, h));
}

void main() {
  vec3 p = position;

  // Thinking: bands of the surface twist around the vertical axis.
  float twist = uSwirl * 0.55 * sin(p.y * 3.0 + uTime * 1.3);
  float c = cos(twist);
  float s = sin(twist);
  p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);

  float n = snoise(p * uFreq + vec3(0.0, uTime * 0.6, uTime * 0.35));
  float n2 = snoise(p * uFreq * 2.4 + vec3(uTime * 0.9));

  // The voice: a ripple running up from the base, as strong as the level.
  float ripple = 0.5 + 0.5 * sin(p.y * 7.0 - uClock * 9.0);
  float disp = n * uAmp + n2 * uAmp * 0.4 + uLevel * (0.06 + 0.15 * ripple) * (0.65 + 0.35 * n);

  // A few particles lift off the rim, mostly from the warm base.
  float lift = smoothstep(0.86, 1.0, aSeed) * (0.08 + 0.5 * max(n, 0.0)) * uFray * (0.6 + 0.8 * smoothstep(0.3, -0.9, p.y));

  vec3 pos = p * (uScale + disp + lift);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  vec3 nv = normalize(normalMatrix * p);
  float facing = nv.z;
  float rim = 1.0 - abs(facing);
  vColor = palette(clamp(nv.y * 0.5 + 0.5 + n * 0.08, 0.0, 1.0));

  // A handful of particles flare white for a moment.
  float flare = step(0.986, aSeed) * pow(0.5 + 0.5 * sin(uClock * (1.5 + aSeed * 3.0) + aSeed * 60.0), 6.0);
  vColor = mix(vColor, vec3(1.0, 0.96, 0.92), flare);

  // No glow: the far side shows through faintly and the rim brightens by density alone.
  vAlpha = mix(0.16, 0.75, smoothstep(-0.8, 0.2, facing)) * (0.75 + 0.5 * rim) * (0.7 + 0.3 * aSeed) + flare * 0.5 + lift;
  float size = uSize * (0.55 + aSeed * 0.75) * (1.0 + uLevel * 0.35) * (1.0 - lift * 0.4);
  gl_PointSize = size * uPixelRatio * (3.2 / -mv.z);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, smoothstep(0.5, 0.18, d) * vAlpha);
}
`;

/** Points on a unit sphere in latitude rows, bricked so the grid reads as dots rather than lines. */
function buildSphere(rings: number) {
  const pos: number[] = [];
  const seed: number[] = [];
  for (let i = 0; i < rings; i++) {
    const phi = (Math.PI * (i + 0.5)) / rings;
    const r = Math.sin(phi);
    const y = Math.cos(phi);
    const count = Math.max(3, Math.round(rings * 2 * r));
    const offset = (i % 2) * 0.5;
    for (let j = 0; j < count; j++) {
      const theta = ((j + offset + (Math.random() - 0.5) * 0.18) / count) * Math.PI * 2;
      pos.push(r * Math.cos(theta), y, r * Math.sin(theta));
      seed.push(Math.random());
    }
  }
  return { positions: new Float32Array(pos), seeds: new Float32Array(seed) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The receptionist: a particle sphere (Three.js) that breathes at rest, leans in to listen,
 * twists while it thinks and ripples with its voice.
 */
export function Orb({
  state = "idle",
  level,
  inputLevel,
  className = "",
  label = "The receptionist",
  interactive = true
}: {
  state?: OrbState;
  /** The agent's live voice level (0–1). Without it, speaking uses a stand-in envelope. */
  level?: () => number;
  /** The caller's voice level (0–1), shown while listening. */
  inputLevel?: () => number;
  className?: string;
  label?: string;
  /** Tilt toward the pointer. */
  interactive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const setLook = useRef<((s: OrbState) => void) | null>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const inputRef = useRef(inputLevel);
  stateRef.current = state;
  levelRef.current = level;
  inputRef.current = inputLevel;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let teardown = () => {};

    (async () => {
      const [THREE, { gsap }] = await Promise.all([import("three"), import("gsap")]);
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      } catch {
        return; // no WebGL: the dotted poster stays
      }

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const finePointer = window.matchMedia("(pointer: fine)").matches;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = renderer.domElement;
      canvas.className = "orb-canvas";
      canvas.setAttribute("aria-hidden", "true");
      renderer.setPixelRatio(dpr);
      renderer.setClearColor(0x000000, 0);
      el.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
      camera.position.z = 4.4;

      // About 3.5 px between dots at any size: more rows on a bigger orb.
      const box = el.getBoundingClientRect();
      const px = Math.max(80, Math.min(box.width, box.height) || 240);
      const { positions, seeds } = buildSphere(Math.round(Math.min(128, Math.max(64, px * 0.34))));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

      const look: Look = { ...LOOKS[stateRef.current] };
      const uniforms = {
        uTime: { value: 0 },
        uClock: { value: 0 },
        uAmp: { value: look.amp },
        uFreq: { value: look.freq },
        uScale: { value: look.scale },
        uSwirl: { value: look.swirl },
        uFray: { value: look.fray },
        uLevel: { value: 0 },
        uSize: { value: 2.4 },
        uPixelRatio: { value: dpr }
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      });
      const points = new THREE.Points(geometry, material);
      points.rotation.x = 0.28;
      scene.add(points);

      const resize = () => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        renderer.setSize(r.width, r.height, false);
        camera.aspect = r.width / r.height;
        camera.updateProjectionMatrix();
        uniforms.uSize.value = 2.4 * Math.min(1.25, Math.max(0.95, Math.min(r.width, r.height) / 300));
      };
      resize();
      const sizer = new ResizeObserver(resize);
      sizer.observe(el);

      let pointerX = 0;
      let pointerY = 0;
      const onPointer = (e: PointerEvent) => {
        pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
        pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      if (interactive && finePointer && !reduced) window.addEventListener("pointermove", onPointer, { passive: true });

      let tiltX = 0.28;
      let tiltY = 0;
      let spin = 0;
      let voice = 0;
      let phase = 0;
      let syllable = 0;
      let nextSyllable = 0;
      let last = performance.now();
      let raf = 0;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const s = stateRef.current;

        let target = 0;
        if (s === "speaking") {
          const fn = levelRef.current;
          if (fn) target = clamp01((fn() - 0.01) * 5.5);
          else {
            if (now > nextSyllable) {
              syllable = Math.random() < 0.16 ? 0.04 : 0.32 + Math.random() * 0.68;
              nextSyllable = now + 80 + Math.random() * 90;
            }
            target = syllable;
          }
        } else if (s === "listening") {
          const fn = inputRef.current;
          if (fn) target = clamp01(fn() * 6) * 0.55;
        }
        if (reduced) target *= 0.35;
        voice += (target - voice) * (target > voice ? 0.42 : 0.1);

        phase += dt * look.speed * (reduced ? 0.15 : 1);
        if (!reduced) spin += dt * look.spin;
        tiltX += (0.28 + pointerY * 0.2 - tiltX) * 0.05;
        tiltY += (pointerX * 0.35 - tiltY) * 0.05;
        points.rotation.set(tiltX, spin + tiltY, 0);

        uniforms.uTime.value = phase;
        uniforms.uClock.value = now / 1000;
        uniforms.uAmp.value = look.amp;
        uniforms.uFreq.value = look.freq;
        uniforms.uScale.value = look.scale + (reduced ? 0 : Math.sin(now / 900) * 0.012);
        uniforms.uSwirl.value = look.swirl;
        uniforms.uFray.value = look.fray;
        uniforms.uLevel.value = voice;
        renderer.render(scene, camera);
        if (!el.dataset.ready) el.dataset.ready = "1";
      };

      // Draw only while on screen and the tab is visible.
      let onScreen = false;
      const sync = () => {
        cancelAnimationFrame(raf);
        if (onScreen && !document.hidden) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      };
      const watcher = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      }, { rootMargin: "120px" });
      watcher.observe(el);
      document.addEventListener("visibilitychange", sync);

      const onLost = (e: Event) => {
        e.preventDefault();
        delete el.dataset.ready;
      };
      canvas.addEventListener("webglcontextlost", onLost);

      setLook.current = s => {
        gsap.to(look, { ...LOOKS[s], duration: s === "thinking" ? 0.9 : 0.7, ease: "power3.out", overwrite: true });
      };

      teardown = () => {
        cancelAnimationFrame(raf);
        watcher.disconnect();
        sizer.disconnect();
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("pointermove", onPointer);
        canvas.removeEventListener("webglcontextlost", onLost);
        gsap.killTweensOf(look);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
        delete el.dataset.ready;
        setLook.current = null;
      };
    })();

    return () => {
      disposed = true;
      teardown();
    };
  }, [interactive]);

  useEffect(() => {
    setLook.current?.(state);
  }, [state]);

  return (
    <div ref={host} className={`orb ${className}`} role="img" aria-label={`${label}, ${STATE_WORD[state]}`}>
      <span className="orb-poster" aria-hidden="true" />
    </div>
  );
}
