import { useEffect, useRef } from "react";
import { coverUrl } from "../api";
import { shift, type Rgb } from "../util/dominantColor";

interface Props {
  coverPath: string | null;
  title: string;
  /** Width in pixels of the rendered cover. */
  width?: number;
  /** Book "thickness" in pixels. */
  depth?: number;
  /** Dominant color extracted from the cover, tints the spine/back/edges. */
  tint?: Rgb | null;
}

// Inline SVG noise → paper grain. ~280 bytes, no extra asset.
const GRAIN_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0'/></filter>` +
      `<rect width='100%' height='100%' filter='url(%23n)' opacity='0.7'/></svg>`,
  );

export function Book3D({
  coverPath,
  title,
  width = 180,
  depth = 32,
  tint,
}: Props) {
  const height = Math.round(width * 1.5);
  const src = coverUrl(coverPath);
  const halfDepth = depth / 2;

  // All animation state lives in refs — we mutate CSS variables directly
  // on the stage element each frame, so React never re-renders mid-drag.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rot = useRef({ x: -10, y: -26 });
  const target = useRef({ x: -10, y: -26 });
  const velocity = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const lastPointer = useRef<{ x: number; y: number; t: number } | null>(null);
  const flipped = useRef(false);
  const lastInteract = useRef(performance.now());
  const lastFrame = useRef(performance.now());

  // ── Colors derived from tint ───────────────────────────────────────────
  const baseTint: Rgb = tint ?? { r: 38, g: 36, b: 50 };
  const spineCol = shift(baseTint, -0.55);
  const backCol = shift(baseTint, -0.72);
  const edgeLight: Rgb = tint
    ? { r: (tint.r + 240) / 2, g: (tint.g + 235) / 2, b: (tint.b + 224) / 2 }
    : { r: 243, g: 236, b: 216 };
  const edgeDark = shift(edgeLight, -0.22);
  const rgbStr = (c: Rgb) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

  // Page edges: fine striations (the paper stack), banded shading toward
  // the middle (where pages bend), and a few faint "page splits".
  const edgeStriations = `repeating-linear-gradient(to bottom, rgba(60,42,18,0.10) 0, rgba(60,42,18,0.10) 0.5px, transparent 0.5px, transparent 2px)`;
  const edgePageSplits = `repeating-linear-gradient(to bottom, transparent 0, transparent 14px, rgba(40,28,10,0.18) 14px, rgba(40,28,10,0.18) 14.5px, transparent 14.5px, transparent 31px)`;
  const edgeBg = `${edgeStriations}, ${edgePageSplits}, linear-gradient(to right, ${rgbStr(edgeLight)} 0%, ${rgbStr(edgeDark)} 50%, ${rgbStr(edgeLight)} 100%)`;
  const edgeBgV = `repeating-linear-gradient(to right, rgba(60,42,18,0.10) 0, rgba(60,42,18,0.10) 0.5px, transparent 0.5px, transparent 2px), linear-gradient(to bottom, ${rgbStr(edgeLight)} 0%, ${rgbStr(edgeDark)} 50%, ${rgbStr(edgeLight)} 100%)`;

  // Spine: dark gradient + faint raised "hubs" (the bands you see on hardcovers).
  const spineGrad = `linear-gradient(to right, ${rgbStr(shift(spineCol, -0.22))} 0%, ${rgbStr(shift(spineCol, 0.04))} 45%, ${rgbStr(shift(spineCol, -0.28))} 100%)`;
  const spineHubs = `repeating-linear-gradient(to bottom, transparent 0, transparent 18%, rgba(255,255,255,0.06) 18%, rgba(255,255,255,0.06) 18.6%, rgba(0,0,0,0.18) 18.6%, rgba(0,0,0,0.18) 19.4%, transparent 19.4%, transparent 19.8%)`;
  const spineBg = `${spineHubs}, ${spineGrad}`;

  const backGrad = `linear-gradient(135deg, ${rgbStr(shift(backCol, 0.08))} 0%, ${rgbStr(backCol)} 60%, ${rgbStr(shift(backCol, -0.1))} 100%)`;

  // ── RAF loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(50, now - lastFrame.current);
      lastFrame.current = now;
      const sinceInteract = now - lastInteract.current;
      const idle = !dragging.current && sinceInteract > 1100;

      let tx = target.current.x;
      let ty = target.current.y;

      const flourishesOn =
        document.documentElement.getAttribute("data-flourishes") !== "off";
      if (idle && !flipped.current && flourishesOn) {
        // Time-based, framerate-independent drift.
        const t = now / 1000;
        tx += Math.sin(t * 0.55) * 0.8;
        ty += Math.sin(t * 0.42) * 1.4;
      }

      if (!dragging.current) {
        const v = velocity.current;
        if (Math.abs(v.x) + Math.abs(v.y) > 0.02) {
          target.current = {
            x: clampPitch(target.current.x + v.x),
            y: target.current.y + v.y,
          };
          const decay = Math.pow(0.92, dt / 16.67);
          velocity.current = { x: v.x * decay, y: v.y * decay };
        }
      }

      const ease = dragging.current ? 0.55 : 1 - Math.pow(1 - 0.16, dt / 16.67);
      rot.current.x += (tx - rot.current.x) * ease;
      rot.current.y += (ty - rot.current.y) * ease;

      writeVars();
      raf = requestAnimationFrame(tick);
    };

    const writeVars = () => {
      const el = stageRef.current;
      if (!el) return;
      const rx = rot.current.x;
      const ry = rot.current.y;

      // Lighting: key light from upper-left (-30°, -45° from book normal).
      // Compute facing dot product roughly via yaw/pitch.
      const yawR = (ry * Math.PI) / 180;
      const pitchR = (rx * Math.PI) / 180;
      const cosY = Math.cos(yawR);
      const cosP = Math.cos(pitchR);
      // Front-facing brightness 0..1.
      const facing = Math.max(0, cosY * cosP);
      // Light comes from upper-left → cover gets brighter at positive yaw, brighter at negative pitch.
      const keyDir = Math.max(0, Math.cos((ry + 35) * Math.PI / 180) * Math.cos((rx - 20) * Math.PI / 180));
      const rimDir = Math.max(0, Math.cos((ry - 60) * Math.PI / 180));

      // Shadow geometry.
      const shadowX = Math.sin(yawR) * (depth * 0.9);
      const shadowY = Math.abs(Math.sin(pitchR)) * 9;
      const shadowSX = 0.74 + Math.cos(yawR) * 0.20;
      const shadowOp = Math.max(0.16, 0.55 - Math.abs(pitchR) * 0.45);
      const shadowBlur = 14 + Math.abs(Math.sin(yawR)) * 10;
      // Contact shadow stays tight, mostly tied to pitch.
      const contactOp = Math.max(0.22, 0.5 - Math.abs(pitchR) * 0.6);

      // Specular band across the cover.
      const shineX = 50 - ry * 0.55;
      const shineAngle = 100 + ry * 0.35;
      const shineOp = 0.06 + keyDir * 0.22;

      // Ambient face shading: darken the face as it turns away.
      const faceShade = 0.55 + facing * 0.45;
      const rimGlow = rimDir * 0.18;

      const s = el.style;
      s.setProperty("--b3d-rx", `${rx}deg`);
      s.setProperty("--b3d-ry", `${ry}deg`);
      s.setProperty("--b3d-shadow-x", `${shadowX}px`);
      s.setProperty("--b3d-shadow-y", `${shadowY}px`);
      s.setProperty("--b3d-shadow-sx", `${shadowSX}`);
      s.setProperty("--b3d-shadow-op", `${shadowOp}`);
      s.setProperty("--b3d-shadow-blur", `${shadowBlur}px`);
      s.setProperty("--b3d-contact-op", `${contactOp}`);
      s.setProperty("--b3d-shine-x", `${shineX - 50}%`);
      s.setProperty("--b3d-shine-angle", `${shineAngle}deg`);
      s.setProperty("--b3d-shine-op", `${shineOp}`);
      s.setProperty("--b3d-face-shade", `${faceShade}`);
      s.setProperty("--b3d-rim", `${rimGlow}`);
    };

    writeVars();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [depth]);

  // ── Pointer ────────────────────────────────────────────────────────────
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    dragMoved.current = false;
    lastInteract.current = performance.now();
    lastPointer.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    velocity.current = { x: 0, y: 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const last = lastPointer.current;
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved.current = true;
    const now = performance.now();
    target.current = {
      x: clampPitch(target.current.x - dy * 0.45),
      y: target.current.y + dx * 0.55,
    };
    const dt = Math.max(8, now - last.t);
    velocity.current = {
      x: -(dy / dt) * 7,
      y: (dx / dt) * 9,
    };
    lastPointer.current = { x: e.clientX, y: e.clientY, t: now };
    lastInteract.current = now;
  };
  const onUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* nothing */
    }
    lastPointer.current = null;
    lastInteract.current = performance.now();
    // Click without dragging → flip to back / front.
    if (!dragMoved.current) {
      flipped.current = !flipped.current;
      target.current = {
        x: flipped.current ? -6 : -10,
        y: flipped.current ? 180 - 26 : -26,
      };
      velocity.current = { x: 0, y: 0 };
    }
  };

  return (
    <div
      ref={stageRef}
      className="book3d-stage"
      style={{ width, height: height + 32 }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={() => {
        dragging.current = false;
        lastPointer.current = null;
      }}
    >
      <div className="book3d" style={{ width, height }}>
        {/* Front cover */}
        <div
          className="book3d-face book3d-front"
          style={{ transform: `translateZ(${halfDepth}px)` }}
        >
          {src ? (
            <img src={src} alt={title} draggable={false} />
          ) : (
            <div
              className="book3d-fallback"
              style={{ background: rgbStr(spineCol) }}
            >
              <span>{title.slice(0, 1).toUpperCase()}</span>
            </div>
          )}
          {/* Paper grain */}
          <div
            className="book3d-grain"
            style={{ backgroundImage: `url("${GRAIN_URL}")` }}
          />
          {/* Ambient face shading (darkens as cover turns away) */}
          <div className="book3d-face-shade" />
          {/* Specular shine band */}
          <div className="book3d-front-shine" />
          {/* Rim light along right edge as book yaws */}
          <div className="book3d-rim" />
          {/* Spine-side inner shadow (where binding meets cover) */}
          <div className="book3d-front-inner-shadow" />
          {/* Subtle embossed border */}
          <div className="book3d-bevel" />
        </div>

        {/* Back */}
        <div
          className="book3d-face book3d-back"
          style={{
            transform: `translateZ(-${halfDepth}px) rotateY(180deg)`,
            background: backGrad,
          }}
        >
          <div
            className="book3d-grain"
            style={{ backgroundImage: `url("${GRAIN_URL}")`, opacity: 0.18 }}
          />
          <div className="book3d-back-emboss" />
        </div>

        {/* Spine */}
        <div
          className="book3d-face book3d-spine"
          style={{
            width: depth,
            height,
            transform: `translateX(-${halfDepth}px) rotateY(-90deg)`,
            background: spineBg,
          }}
        >
          <span className="book3d-spine-title">{title}</span>
        </div>

        {/* Right page edge */}
        <div
          className="book3d-face book3d-edge"
          style={{
            width: depth,
            height,
            transform: `translateX(${width - halfDepth}px) rotateY(90deg)`,
            background: edgeBg,
          }}
        />

        {/* Top */}
        <div
          className="book3d-face book3d-top"
          style={{
            width,
            height: depth,
            transform: `translateY(-${halfDepth}px) rotateX(90deg)`,
            background: edgeBgV,
          }}
        />

        {/* Bottom */}
        <div
          className="book3d-face book3d-bottom"
          style={{
            width,
            height: depth,
            transform: `translateY(${height - halfDepth}px) rotateX(-90deg)`,
            background: edgeBgV,
          }}
        />
      </div>

      {/* Soft ambient shadow (cast) */}
      <div
        className="book3d-shadow"
        style={{ width: width * 0.82 }}
      />
      {/* Tight contact shadow under the spine edge */}
      <div
        className="book3d-contact"
        style={{ width: width * 0.55 }}
      />
    </div>
  );
}

function clampPitch(n: number): number {
  if (n > 38) return 38;
  if (n < -38) return -38;
  return n;
}
