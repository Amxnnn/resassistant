"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { LATENCY_BUDGET_MS } from "./format";
import { readTheme, subscribeTheme } from "../_brand/theme";

/* The response-time stage: every timed reply as a column of its pipeline stages, standing on a
   rust-lit floor under a glass sheet at the latency budget, in the page's light or dark. Three.js draws it; GSAP builds it, moves
   the columns between orders and dims the ones not in focus. Without WebGL a flat chart of the
   same columns stands in, and the table under it holds every value either way. */

export type TimedTurn = {
  key: string;
  call: number; // the call's position, oldest first: replies of one call stand together
  callLabel: string; // "Today, 7:47 PM, booked a table"
  reply: number; // timed reply number within the call
  total: number;
  eou: number | null;
  stt: number | null;
  llm: number | null;
  tts: number | null;
  model: string;
};

export type StageKey = "eou" | "llm" | "tts" | "other";
export type TurnOrder = "calls" | "fastest";

// The orb's own ramp: listening is cool, thinking rose, speaking warm. Validated for colour-blind
// separation on the cell surface; keep in step with --stage-* in globals.css.
export const STAGES: { key: StageKey; label: string; color: string }[] = [
  { key: "eou", label: "Turn detection", color: "#7c86ff" },
  { key: "llm", label: "Model first token", color: "#e0528d" },
  { key: "tts", label: "Voice first audio", color: "#c8812f" },
  { key: "other", label: "Other and untimed", color: "#6e6560" }
];

const INK = "#f3efe9";
// The same stage on a light page: dark ink, pale resting columns and gridlines, a softer floor light,
// and a fainter reflection (colour on white reads louder than colour on black).
const LOOK = {
  dark: { ink: INK, rest: [0.16, 0.145, 0.14], grid: 0x2e2724, floor: [0.56, 0.23, 0.09, 0.26], pane: 0.075, edge: 0.6, mirror: 0.2 },
  light: { ink: "#1d1a18", rest: [0.86, 0.84, 0.82], grid: 0xddd5ce, floor: [0.94, 0.5, 0.25, 0.16], pane: 0.05, edge: 0.5, mirror: 0.08 }
} as const;
const NARROW_REPLIES = 60; // a phone-shaped stage shows the latest replies only, so columns stay readable
const H = 4.4; // world height of the axis maximum
const GAP = 0.035; // the surface gap between stacked stages
const CALL_GAP = 0.9; // extra room between calls, in column slots

/** Speech to text runs inside turn detection, so it isn't stacked. Stages that overrun the total
 *  (they're timed separately) are scaled to fit; what's left is waiting the stages don't cover. */
export function stageSplit(t: TimedTurn): Record<StageKey, number> {
  const eou = t.eou ?? 0;
  const llm = t.llm ?? 0;
  const tts = t.tts ?? 0;
  const sum = eou + llm + tts;
  const k = sum > t.total ? t.total / sum : 1;
  return { eou: eou * k, llm: llm * k, tts: tts * k, other: Math.max(0, t.total - sum * k) };
}

/** The axis top. A few very slow replies would flatten the rest, so past the 90th percentile the
 *  columns are cut and their real value is printed above them. */
export function axisFor(totals: number[], budget = LATENCY_BUDGET_MS) {
  const sorted = [...totals].sort((a, b) => a - b);
  const top = sorted[sorted.length - 1] ?? budget;
  const p90 = sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? top;
  const reach = Math.max(top <= p90 * 2 ? top : p90, budget * 1.5);
  let step = reach > 8000 ? 2000 : reach > 3000 ? 1000 : 500;
  let max = Math.ceil(reach / step) * step;
  if (max / step > 6) step *= 2;
  max = Math.ceil(reach / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  return { max, ticks };
}

export function formatMs(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ms`;
}

function seconds(n: number) {
  if (n === 0) return "0";
  return `${n % 1000 === 0 ? n / 1000 : (n / 1000).toFixed(1)} s`;
}

/** Column order on screen: indices into `turns`, left to right. */
export function visualOrder(turns: TimedTurn[], order: TurnOrder) {
  const idx = turns.map((_, i) => i);
  return order === "fastest" ? idx.sort((a, b) => turns[a].total - turns[b].total) : idx;
}

function layout(turns: TimedTurn[], order: TurnOrder, width: number) {
  const n = turns.length;
  const calls = new Set(turns.map(t => t.call)).size;
  const grouped = n + CALL_GAP * Math.max(0, calls - 1);
  const xs = new Array<number>(n);
  if (order === "fastest") {
    visualOrder(turns, order).forEach((i, rank) => (xs[i] = -width / 2 + ((rank + 0.5) * width) / n));
  } else {
    let u = 0;
    turns.forEach((t, i) => {
      if (i > 0 && t.call !== turns[i - 1].call) u += CALL_GAP;
      xs[i] = -width / 2 + ((u + 0.5) * width) / grouped;
      u += 1;
    });
  }
  const slot = width / Math.max(n, grouped);
  return { xs, slot, column: Math.min(slot * 0.68, 0.46) };
}

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aFocus;
varying vec3 vColor;
varying float vShade;
varying float vFocus;
varying float vY;

void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  // Light from above and in front: the top catches it, the side facing away falls dark,
  // and each side darkens a little towards the floor.
  float side = abs(normal.z) > 0.5 ? 0.95 : 0.74;
  vShade = normal.y > 0.5 ? 1.16 : (normal.y < -0.5 ? 0.55 : side * mix(0.84, 1.0, position.y));
  vColor = aColor;
  vFocus = aFocus;
  vY = world.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uReflect;
uniform float uMirror;
uniform vec3 uRest;
varying vec3 vColor;
varying float vShade;
varying float vFocus;
varying float vY;

void main() {
  vec3 c = mix(uRest, vColor, 0.22 + 0.78 * vFocus) * vShade;
  float a = uReflect > 0.5 ? uMirror * smoothstep(-1.5, 0.0, vY) * (0.35 + 0.65 * vFocus) : 1.0;
  gl_FragColor = vec4(c, a);
}
`;

const FLOOR_FRAGMENT = /* glsl */ `
uniform vec4 uFloor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.9);
  float glow = 1.0 - smoothstep(0.0, 0.5, length(p));
  gl_FragColor = vec4(uFloor.rgb, uFloor.a * glow * glow);
}
`;

type Col = { x: number; grow: number; focus: number };
type Api = { setOrder: (o: TurnOrder) => void; setActive: (i: number | null) => void };

export function LatencyStage({
  turns: allTurns,
  order,
  budget = LATENCY_BUDGET_MS
}: {
  turns: TimedTurn[];
  order: TurnOrder;
  budget?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const introPlayed = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const [active, setActive] = useState<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [mode, setMode] = useState<"loading" | "3d" | "flat">("loading");
  // Bumped when the theme changes, so the scene is rebuilt in the other look.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => subscribeTheme(() => setThemeTick(t => t + 1)), []);
  const [shape, setShape] = useState<"wide" | "narrow">("wide");
  const turns = useMemo(() => (shape === "narrow" ? allTurns.slice(-NARROW_REPLIES) : allTurns), [allTurns, shape]);

  const axis = useMemo(() => axisFor(turns.map(t => t.total), budget), [turns, budget]);
  const splits = useMemo(() => turns.map(stageSplit), [turns]);
  const sequence = useMemo(() => visualOrder(turns, order), [turns, order]);
  const signature = turns.map(t => `${t.key}:${t.total}`).join("|");

  // A phone-shaped stage gets a narrower world, so the columns fill it instead of a thin band.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setShape(width / height >= 1.7 ? "wide" : "narrow");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || turns.length === 0) return;
    let disposed = false;
    let teardown = () => {};

    (async () => {
      const [THREE, { gsap }] = await Promise.all([import("three"), import("gsap")]);
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        setMode("flat");
        return;
      }

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      const canvas = renderer.domElement;
      canvas.className = "viz-canvas";
      canvas.setAttribute("aria-hidden", "true");
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      el.prepend(canvas);

      const look = LOOK[readTheme()];
      const n = turns.length;
      const width = shape === "wide" ? 12 : 5.4;
      const toY = (v: number) => (Math.min(v, axis.max) / axis.max) * H;
      const place = layout(turns, orderRef.current, width);
      const depth = place.column;
      const cols: Col[] = place.xs.map(x => ({ x, grow: 0, focus: 1 }));

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
      const target = new THREE.Vector3(0, H * 0.4, 0);
      const rig = { yaw: -0.34, pitch: 0.17, zoom: 1 };
      const base = { yaw: rig.yaw, pitch: rig.pitch };
      let fit = 20;

      // Columns: four stacked stages per reply, each a unit box standing on the floor. Colours go to
      // the shader as plain sRGB, so the validated hexes reach the screen unchanged.
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0.5, 0);
      const colors = new Float32Array(n * 4 * 3);
      const focus = new Float32Array(n * 4).fill(1);
      turns.forEach((_, i) => STAGES.forEach((s, k) => colors.set(hexRgb(s.color), (i * 4 + k) * 3)));
      const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
      const focusAttr = new THREE.InstancedBufferAttribute(focus, 1);
      box.setAttribute("aColor", colorAttr);
      box.setAttribute("aFocus", focusAttr);

      const rest = new THREE.Vector3(...look.rest);
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uReflect: { value: 0 }, uMirror: { value: look.mirror }, uRest: { value: rest } }
      });
      const columns = new THREE.InstancedMesh(box, material, n * 4);
      columns.frustumCulled = false;
      columns.renderOrder = 2;
      scene.add(columns);

      // A faint reflection in the floor: the same instances, mirrored, fading with depth.
      const mirror = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uReflect: { value: 1 }, uMirror: { value: look.mirror }, uRest: { value: rest } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const reflection = new THREE.InstancedMesh(box, mirror, n * 4);
      reflection.instanceMatrix = columns.instanceMatrix;
      reflection.scale.y = -1;
      reflection.frustumCulled = false;
      reflection.renderOrder = 1;
      scene.add(reflection);

      // Replies past the axis top get a bright cap; their value is printed above it.
      const clipped = turns.map(t => t.total > axis.max);
      const capMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: look.ink }),
        n
      );
      capMesh.frustumCulled = false;
      capMesh.renderOrder = 2;
      scene.add(capMesh);

      // The rust light on the floor, as on the rest of the site.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 7, 7),
        new THREE.ShaderMaterial({
          vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
          fragmentShader: FLOOR_FRAGMENT,
          uniforms: { uFloor: { value: new THREE.Vector4(...look.floor) } },
          transparent: true,
          depthWrite: false
        })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.002;
      floor.renderOrder = 0;
      scene.add(floor);

      // Hairline gridlines on a back wall at each tick, and the floor line in front.
      const wallZ = -1.15;
      const grid: number[] = [];
      for (const t of axis.ticks) grid.push(-width / 2 - 0.25, toY(t), wallZ, width / 2 + 0.25, toY(t), wallZ);
      grid.push(-width / 2 - 0.25, 0, 0.75, width / 2 + 0.25, 0, 0.75);
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
      const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: look.grid }));
      scene.add(gridLines);

      // The budget: a sheet of glass the slow replies pierce, drawn in from the left.
      const sheetW = width + 0.7;
      const sheet = new THREE.Group();
      sheet.position.set(-sheetW / 2, toY(budget), 0);
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(sheetW, 2.3).rotateX(-Math.PI / 2).translate(sheetW / 2, 0, -0.2),
        new THREE.MeshBasicMaterial({ color: look.ink, transparent: true, opacity: look.pane, depthWrite: false, side: THREE.DoubleSide })
      );
      pane.renderOrder = 3;
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.95, sheetW, 0, 0.95, 0, 0, -1.35, sheetW, 0, -1.35], 3));
      const edges = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: look.ink, transparent: true, opacity: look.edge, depthWrite: false })
      );
      edges.renderOrder = 4;
      sheet.add(pane, edges);
      const wipe = { v: 0 };
      scene.add(sheet);

      const m = new THREE.Matrix4();
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      const apply = () => {
        cols.forEach((c, i) => {
          const s = splits[i];
          const top = toY(turns[i].total) * c.grow;
          let y = 0;
          STAGES.forEach((stage, k) => {
            const id = i * 4 + k;
            focus[id] = c.focus;
            const h = Math.min(toY(s[stage.key]) * c.grow, Math.max(0, top - y));
            const start = y + (y > 0 && h > 0 ? GAP : 0);
            const drawn = h - (start - y);
            if (drawn > 0.002) {
              m.makeScale(depth, drawn, depth).setPosition(c.x, start, 0);
              columns.setMatrixAt(id, m);
            } else columns.setMatrixAt(id, zero);
            y += h;
          });
          if (clipped[i] && c.grow > 0.98) {
            m.makeScale(depth * 1.3, 0.035, depth * 1.3).setPosition(c.x, top + 0.08, 0);
            capMesh.setMatrixAt(i, m);
          } else capMesh.setMatrixAt(i, zero);
        });
        columns.instanceMatrix.needsUpdate = true;
        capMesh.instanceMatrix.needsUpdate = true;
        focusAttr.needsUpdate = true;
        sheet.scale.x = Math.max(0.0001, wipe.v);
      };

      // HTML labels ride the 3D positions: ticks on the back wall, the budget at the sheet's
      // right edge, cut-off values above their caps, and the tooltip over the column in focus.
      const v = new THREE.Vector3();
      const box2d = { w: 1, h: 1 };
      const project = (x: number, y: number, z: number) => {
        v.set(x, y, z).project(camera);
        return [((v.x + 1) / 2) * box2d.w, ((1 - v.y) / 2) * box2d.h];
      };
      const placeOverlay = () => {
        const layer = overlay.current;
        if (!layer) return;
        layer.querySelectorAll<HTMLElement>("[data-tick]").forEach(node => {
          const [px, py] = project(-width / 2 - 0.3, toY(Number(node.dataset.tick)), wallZ);
          // Right-aligned to the wall's edge, but never pushed off the left of the card.
          node.style.transform = `translate(${Math.max(px, node.offsetWidth + 14)}px, ${py}px)`;
        });
        const label = layer.querySelector<HTMLElement>("[data-budget]");
        if (label) {
          const [px, py] = project(-sheetW / 2 + sheetW * wipe.v, toY(budget), 0.95);
          label.style.transform = `translate(${px}px, ${py}px)`;
          label.style.opacity = String(Math.max(0, wipe.v - 0.6) / 0.4);
        }
        // Cut-off values, left to right; one that would overlap its neighbour stays in the tooltip.
        const clips = Array.from(layer.querySelectorAll<HTMLElement>("[data-clip]"))
          .map(node => {
            const i = Number(node.dataset.clip);
            const [px, py] = project(cols[i].x, toY(turns[i].total) * cols[i].grow + 0.12, 0);
            return { node, c: cols[i], px, py, w: node.offsetWidth };
          })
          .sort((a, b) => a.px - b.px);
        let right = -Infinity;
        for (const { node, c, px, py, w } of clips) {
          node.style.transform = `translate(${px}px, ${py}px)`;
          const shown = c.grow > 0.98 && px - w / 2 > right + 6;
          node.style.opacity = shown ? String(0.35 + 0.65 * c.focus) : "0";
          if (shown) right = px + w / 2;
        }
        const i = activeRef.current;
        if (tip.current && i !== null && cols[i]) {
          const [px, py] = project(cols[i].x, toY(turns[i].total) * cols[i].grow + (clipped[i] ? 0.5 : 0.15), 0);
          const t = tip.current;
          const left = Math.min(Math.max(px - t.offsetWidth / 2, 8), box2d.w - t.offsetWidth - 8);
          const above = py - t.offsetHeight - 10;
          t.style.transform = `translate(${left}px, ${above < 8 ? py + 18 : above}px)`;
        }
        layer.dataset.ready = "1";
      };

      const resize = () => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        box2d.w = r.width;
        box2d.h = r.height;
        renderer.setSize(r.width, r.height, false);
        camera.aspect = r.width / r.height;
        const vfov = (camera.fov * Math.PI) / 180;
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
        fit = Math.max((width / 2 + 0.75) / Math.tan(hfov / 2), (H * 0.66) / Math.tan(vfov / 2)) + 1.2;
        camera.updateProjectionMatrix();
        dirty = true;
      };

      let dirty = true;
      let onScreen = false;
      let last = "";
      const tick = () => {
        if (!onScreen || document.hidden) return;
        const d = fit * rig.zoom;
        const pose = `${rig.yaw.toFixed(4)}:${rig.pitch.toFixed(4)}:${d.toFixed(3)}`;
        if (!dirty && pose === last) return;
        last = pose;
        dirty = false;
        camera.position.set(
          target.x + d * Math.sin(rig.yaw) * Math.cos(rig.pitch),
          target.y + d * Math.sin(rig.pitch),
          target.z + d * Math.cos(rig.yaw) * Math.cos(rig.pitch)
        );
        camera.lookAt(target);
        camera.updateMatrixWorld();
        apply();
        renderer.render(scene, camera);
        placeOverlay();
      };
      const mark = () => {
        dirty = true;
      };
      gsap.ticker.add(tick);
      resize();
      const sizer = new ResizeObserver(resize);
      sizer.observe(el);

      const build = () => {
        if (introPlayed.current || reduced) {
          cols.forEach(c => (c.grow = 1));
          wipe.v = 1;
          dirty = true;
          return;
        }
        introPlayed.current = true;
        // The one authored moment: the camera settles as the replies rise in call order and the
        // budget sheet slides in under them.
        const tl = gsap.timeline({ onUpdate: mark });
        tl.fromTo(rig, { pitch: 0.36, zoom: 1.14 }, { pitch: base.pitch, zoom: 1, duration: 1.7, ease: "power3.out" }, 0);
        tl.to(cols, { grow: 1, duration: 0.95, ease: "power3.out", stagger: Math.min(0.016, 0.75 / n) }, 0.1);
        tl.to(wipe, { v: 1, duration: 1.1, ease: "power2.inOut" }, 0.45);
      };

      let built = false;
      const watcher = new IntersectionObserver(
        ([entry]) => {
          onScreen = entry.isIntersecting;
          dirty = true;
          if (onScreen && !built) {
            built = true;
            build();
          }
        },
        { threshold: 0.2 }
      );
      watcher.observe(el);
      const onVisible = () => {
        dirty = true;
      };
      document.addEventListener("visibilitychange", onVisible);

      // The pointer leans the camera a little, and picks the column nearest to it.
      const raycaster = new THREE.Raycaster();
      const wallPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const hit = new THREE.Vector3();
      const ndc = new THREE.Vector2();
      const pick = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        if (!raycaster.ray.intersectPlane(wallPlane, hit) || hit.y < -0.4 || hit.y > H + 0.8) return null;
        let best: number | null = null;
        let gap = place.slot * 0.75;
        cols.forEach((c, i) => {
          const dx = Math.abs(c.x - hit.x);
          if (dx < gap) {
            gap = dx;
            best = i;
          }
        });
        return best;
      };
      const leanYaw = gsap.quickTo(rig, "yaw", { duration: 1.4, ease: "power3.out" });
      const leanPitch = gsap.quickTo(rig, "pitch", { duration: 1.4, ease: "power3.out" });
      const onMove = (e: PointerEvent) => {
        if (finePointer && !reduced) {
          const r = el.getBoundingClientRect();
          leanYaw(base.yaw + ((e.clientX - r.left) / r.width - 0.5) * 0.16);
          leanPitch(base.pitch + ((e.clientY - r.top) / r.height - 0.5) * 0.06);
        }
        if (e.pointerType === "mouse") setActive(pick(e));
      };
      const onDown = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") setActive(pick(e));
      };
      const onLeave = (e: PointerEvent) => {
        if (finePointer && !reduced) {
          leanYaw(base.yaw);
          leanPitch(base.pitch);
        }
        if (e.pointerType === "mouse") setActive(null);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointerleave", onLeave);

      api.current = {
        setOrder(o) {
          const next = layout(turns, o, width).xs;
          const rank = visualOrder(turns, o);
          rank.forEach((i, r) => {
            if (reduced) cols[i].x = next[i];
            else gsap.to(cols[i], { x: next[i], duration: 1, delay: (r / n) * 0.28, ease: "power3.inOut", overwrite: "auto", onUpdate: mark });
          });
          dirty = true;
        },
        setActive(i) {
          cols.forEach((c, j) => {
            const to = i === null || i === j ? 1 : 0.3;
            if (reduced) c.focus = to;
            else gsap.to(c, { focus: to, duration: 0.35, ease: "power2.out", overwrite: "auto", onUpdate: mark });
          });
          dirty = true;
        }
      };
      setMode("3d");

      const onLost = (e: Event) => {
        e.preventDefault();
        setMode("flat");
      };
      canvas.addEventListener("webglcontextlost", onLost);

      teardown = () => {
        api.current = null;
        gsap.ticker.remove(tick);
        gsap.killTweensOf([rig, wipe, ...cols]);
        watcher.disconnect();
        sizer.disconnect();
        document.removeEventListener("visibilitychange", onVisible);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("webglcontextlost", onLost);
        scene.traverse(obj => {
          const mesh = obj as Partial<InstanceType<typeof THREE.Mesh>>;
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach(x => x.dispose());
          else mat?.dispose();
        });
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
      };
    })();

    return () => {
      disposed = true;
      teardown();
    };
    // Rebuilt only when the replies, the axis or the stage's shape change; order and focus tween.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, axis.max, shape, budget, themeTick]);

  useEffect(() => {
    api.current?.setOrder(order);
  }, [order]);

  useEffect(() => {
    api.current?.setActive(active);
  }, [active]);

  const step = (e: React.KeyboardEvent) => {
    if (!turns.length) return;
    const at = active === null ? -1 : sequence.indexOf(active);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = sequence[Math.min(sequence.length - 1, at + 1)];
    else if (e.key === "ArrowLeft") next = sequence[Math.max(0, at === -1 ? sequence.length - 1 : at - 1)];
    else if (e.key === "Home") next = sequence[0];
    else if (e.key === "End") next = sequence[sequence.length - 1];
    else if (e.key === "Escape") return setActive(null);
    else return;
    e.preventDefault();
    setActive(next);
  };

  const focused = active !== null ? turns[active] : null;
  const split = active !== null ? splits[active] : null;

  return (
    <>
      {mode === "flat" ? (
        <FlatStage turns={turns} splits={splits} sequence={sequence} max={axis.max} ticks={axis.ticks} budget={budget} />
      ) : (
        <div
          ref={host}
          className={`viz-stage${mode === "3d" ? " is-live" : ""}`}
          tabIndex={0}
          role="group"
          aria-label={`Response time of each of ${turns.length} replies, split by stage. Use the arrow keys to step through them; the table below lists every value.`}
          onKeyDown={step}
          onBlur={() => setActive(null)}
        >
          <div ref={overlay} className="viz-overlay" aria-hidden="true">
            {axis.ticks.map(t => (
              <span key={t} className="viz-tick" data-tick={t}>
                {seconds(t)}
              </span>
            ))}
            <span className="viz-budget" data-budget>
              {budget} ms budget
            </span>
            {turns.map((t, i) =>
              t.total > axis.max ? (
                <span key={t.key} className="viz-clip" data-clip={i}>
                  {seconds(Math.round(t.total / 100) * 100)}
                </span>
              ) : null
            )}
          </div>
          <div ref={tip} className={`viz-tip${focused ? " is-shown" : ""}`} role="status" aria-live="polite">
            {focused && split && (
              <>
                <p className="viz-tip-value">{formatMs(focused.total)}</p>
                <p className="viz-tip-meta">
                  Reply {focused.reply}, {focused.callLabel}
                </p>
                <ul>
                  {STAGES.map(s => (
                    <li key={s.key}>
                      <i style={{ background: s.color }} aria-hidden="true" />
                      <b>{s.key === "other" ? formatMs(split.other) : focused[s.key] == null ? "not timed" : formatMs(focused[s.key] as number)}</b>
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="viz-tip-meta">{focused.model}</p>
              </>
            )}
          </div>
        </div>
      )}
      <StageLegend budget={budget} />
    </>
  );
}

function hexRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function StageLegend({ budget = LATENCY_BUDGET_MS }: { budget?: number }) {
  return (
    <ul className="viz-legend">
      {STAGES.map(s => (
        <li key={s.key}>
          <i style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
      <li>
        <i className="viz-legend-line" aria-hidden="true" />
        {budget} ms budget
      </li>
    </ul>
  );
}

/** The same columns, flat: shown when WebGL isn't available. */
function FlatStage({
  turns,
  splits,
  sequence,
  max,
  ticks,
  budget
}: {
  turns: TimedTurn[];
  splits: Record<StageKey, number>[];
  sequence: number[];
  max: number;
  ticks: number[];
  budget: number;
}) {
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  return (
    <div className="viz-flat" role="img" aria-label={`Response time of each of ${turns.length} replies, split by stage. The table below lists every value.`}>
      {ticks.map(t => (
        <span key={t} className="viz-flat-tick" style={{ bottom: pct(t) }}>
          <span>{seconds(t)}</span>
        </span>
      ))}
      <span className="viz-flat-budget" style={{ bottom: pct(budget) }} />
      <div className="viz-flat-cols">
        {sequence.map(i => (
          <span key={turns[i].key} className="viz-flat-col" style={{ height: pct(turns[i].total) }}>
            {STAGES.map(s =>
              splits[i][s.key] > 0 ? <i key={s.key} style={{ flexGrow: splits[i][s.key], background: s.color }} /> : null
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
