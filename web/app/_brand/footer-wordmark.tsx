"use client";

import React, { useEffect, useRef } from "react";
import { readTheme, subscribeTheme } from "./theme";

const WORD = "Resassistant";
const SAMPLE_W = 2400; // sampling canvas width; world units match its pixels
const STEP = 5; // one dot every STEP pixels of ink

const VERTEX = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform float uPulse;
uniform vec2 uMouse;
uniform float uHover;
uniform float uScale;
uniform float uPixelRatio;
uniform vec2 uSize;
uniform float uInk;
attribute vec3 aStart;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;

vec3 ramp(float h, vec3 amber, vec3 ember, vec3 rose, vec3 iris) {
  vec3 c = mix(amber, ember, smoothstep(0.0, 0.32, h));
  c = mix(c, rose, smoothstep(0.34, 0.7, h));
  return mix(c, iris, smoothstep(0.7, 1.0, h));
}

// The orb's ramp: lit on the dark footer, in deeper pigments on the light one.
vec3 palette(float h) {
  vec3 lit = ramp(h, vec3(1.0, 0.71, 0.45), vec3(0.95, 0.37, 0.16), vec3(0.74, 0.22, 0.44), vec3(0.38, 0.43, 0.96));
  vec3 ink = ramp(h, vec3(0.93, 0.55, 0.24), vec3(0.84, 0.3, 0.1), vec3(0.62, 0.15, 0.38), vec3(0.27, 0.31, 0.86));
  return mix(lit, ink, uInk);
}

void main() {
  vec2 n = position.xy / uSize + 0.5;          // 0..1 across the word

  // Left to right, each dot lifts off the voice line into its letter.
  float delay = n.x * 0.55 + aSeed * 0.18;
  float p = clamp((uProgress * 1.75 - delay) / 1.0, 0.0, 1.0);
  p = 1.0 - pow(1.0 - p, 3.0);
  vec3 pos = mix(aStart, position, p);

  // Idle shimmer, and a pulse that runs through the word like a voice.
  pos.y += sin(uTime * 1.3 + position.x * 0.02 + aSeed * 6.283) * 0.7 * p;
  float centre = fract(uTime * 0.11) * 1.6 - 0.3;
  float wave = exp(-pow((n.x - centre) / 0.06, 2.0)) * uPulse * p;
  pos.y += wave * 9.0;

  // The cursor parts the dots.
  vec2 away = pos.xy - uMouse;
  float d = length(away);
  float push = smoothstep(150.0, 0.0, d) * uHover;
  pos.xy += normalize(away + 0.0001) * push * 34.0;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  vColor = mix(palette(clamp(n.y + aSeed * 0.08, 0.0, 1.0)), mix(vec3(1.0, 0.95, 0.9), vec3(0.78, 0.25, 0.06), uInk), wave * 0.6);
  vAlpha = ((0.55 + 0.45 * aSeed) * mix(0.35, 1.0, p) + wave * 0.4) * mix(1.0, 1.3, uInk);
  gl_PointSize = (2.8 + aSeed * 1.6 + wave * 2.0) * uScale * uPixelRatio;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, smoothstep(0.5, 0.15, d) * vAlpha);
}
`;

/** Samples the word, set in the page's display serif, into dot positions (canvas pixels, centred). */
function sampleWord(family: string) {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `400 400px ${family}`;
  const size = (400 * SAMPLE_W * 0.96) / probe.measureText(WORD).width;

  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  ctx.font = `400 ${size}px ${family}`;
  const m = ctx.measureText(WORD);
  const pad = size * 0.08;
  const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + pad * 2);
  ctx.canvas.width = SAMPLE_W;
  ctx.canvas.height = h;
  ctx.font = `400 ${size}px ${family}`;
  ctx.fillStyle = "#fff";
  ctx.fillText(WORD, (SAMPLE_W - m.width) / 2, pad + m.actualBoundingBoxAscent);

  const { data } = ctx.getImageData(0, 0, SAMPLE_W, h);
  const target: number[] = [];
  const start: number[] = [];
  const seed: number[] = [];
  for (let y = 0; y < h; y += STEP) {
    for (let x = 0; x < SAMPLE_W; x += STEP) {
      if (data[(y * SAMPLE_W + x) * 4 + 3] < 140) continue;
      const tx = x - SAMPLE_W / 2 + (Math.random() - 0.5) * 1.5;
      const ty = h / 2 - y + (Math.random() - 0.5) * 1.5;
      target.push(tx, ty, 0);
      // Before it forms, every dot rests on one low, flat voice line.
      start.push(tx + (Math.random() - 0.5) * 30, -h * 0.42 + Math.sin(tx * 0.012) * 6 + (Math.random() - 0.5) * 4, 0);
      seed.push(Math.random());
    }
  }
  return { target: new Float32Array(target), start: new Float32Array(start), seed: new Float32Array(seed), h };
}

/**
 * The footer's wordmark in the orb's dots (Three.js). On first sight the dots rise from a voice line
 * into the name (GSAP), a pulse runs through it every few seconds, and the cursor parts the dots.
 */
export function FooterWordmark() {
  const host = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = host.current;
    const label = text.current;
    if (!el || !label) return;
    let disposed = false;
    let teardown = () => {};

    (async () => {
      const family = getComputedStyle(label).fontFamily;
      await document.fonts.load(`400 100px ${family}`).catch(() => undefined);
      const [THREE, { gsap }] = await Promise.all([import("three"), import("gsap")]);
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      } catch {
        return; // no WebGL: the set wordmark stays
      }

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      const { target, start, seed, h } = sampleWord(family);
      el.style.aspectRatio = `${SAMPLE_W} / ${h}`;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = renderer.domElement;
      canvas.setAttribute("aria-hidden", "true");
      renderer.setPixelRatio(dpr);
      renderer.setClearColor(0x000000, 0);
      el.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-SAMPLE_W / 2, SAMPLE_W / 2, h / 2, -h / 2, -10, 10);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(target, 3));
      geometry.setAttribute("aStart", new THREE.BufferAttribute(start, 3));
      geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      const uniforms = {
        uProgress: { value: reduced ? 1 : 0 },
        uTime: { value: 0 },
        uPulse: { value: reduced ? 0 : 1 },
        uMouse: { value: new THREE.Vector2(9999, 9999) },
        uHover: { value: 0 },
        uScale: { value: 1 },
        uPixelRatio: { value: dpr },
        uSize: { value: new THREE.Vector2(SAMPLE_W, h) },
        uInk: { value: 0 }
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
      scene.add(new THREE.Points(geometry, material));

      // Lit by density on the dark footer, inked by density on the light one.
      const applyTheme = () => {
        const ink = readTheme() === "light";
        uniforms.uInk.value = ink ? 1 : 0;
        material.blending = ink ? THREE.NormalBlending : THREE.AdditiveBlending;
        material.needsUpdate = true;
      };
      applyTheme();

      const resize = () => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        renderer.setSize(r.width, r.height, false);
        uniforms.uScale.value = r.width / SAMPLE_W;
        draw();
      };

      // The pointer, in the word's own units, smoothed by GSAP.
      const mouse = { x: 9999, y: 9999 };
      const toX = gsap.quickTo(mouse, "x", { duration: 0.5, ease: "power3.out" });
      const toY = gsap.quickTo(mouse, "y", { duration: 0.5, ease: "power3.out" });
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width - 0.5) * SAMPLE_W;
        const y = (0.5 - (e.clientY - r.top) / r.height) * h;
        if (uniforms.uHover.value === 0) {
          mouse.x = x;
          mouse.y = y;
        }
        toX(x);
        toY(y);
      };
      const onEnter = () => gsap.to(uniforms.uHover, { value: 1, duration: 0.6, ease: "power2.out" });
      const onLeave = () => gsap.to(uniforms.uHover, { value: 0, duration: 0.9, ease: "power2.out" });
      if (finePointer && !reduced) {
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerenter", onEnter);
        el.addEventListener("pointerleave", onLeave);
      }

      const draw = () => {
        uniforms.uMouse.value.set(mouse.x, mouse.y);
        renderer.render(scene, camera);
        if (!el.dataset.ready) el.dataset.ready = "1";
      };

      let raf = 0;
      let formed = reduced;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        uniforms.uTime.value = now / 1000;
        draw();
      };
      let onScreen = false;
      const sync = () => {
        cancelAnimationFrame(raf);
        if (onScreen && !formed) {
          formed = true;
          gsap.to(uniforms.uProgress, { value: 1, duration: 2.8, ease: "power2.out" });
        }
        if (onScreen && !document.hidden && !reduced) raf = requestAnimationFrame(frame);
        else draw();
      };
      const watcher = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      }, { threshold: 0.25 });
      watcher.observe(el);
      document.addEventListener("visibilitychange", sync);
      const unsubscribeTheme = subscribeTheme(() => {
        applyTheme();
        draw();
      });
      const sizer = new ResizeObserver(resize);
      sizer.observe(el);
      resize();

      teardown = () => {
        cancelAnimationFrame(raf);
        unsubscribeTheme();
        watcher.disconnect();
        sizer.disconnect();
        document.removeEventListener("visibilitychange", sync);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerenter", onEnter);
        el.removeEventListener("pointerleave", onLeave);
        gsap.killTweensOf([uniforms.uProgress, uniforms.uHover, mouse]);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
        el.style.removeProperty("aspect-ratio");
        delete el.dataset.ready;
      };
    })();

    return () => {
      disposed = true;
      teardown();
    };
  }, []);

  return (
    <div ref={host} className="footer-word" aria-hidden="true">
      <span ref={text} className="footer-word-text">
        {WORD}
      </span>
    </div>
  );
}
