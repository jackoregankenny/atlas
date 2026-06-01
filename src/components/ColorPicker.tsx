import { useEffect, useRef, useState } from "react";

interface Props {
  /** "r, g, b" triplet that matches what useTheme expects. */
  value: string | null;
  onChange: (rgb: string) => void;
}

interface Hsv { h: number; s: number; v: number; }
interface Rgb { r: number; g: number; b: number; }

export function ColorPicker({ value, onChange }: Props) {
  // Internal HSV. Two-way bind with the value prop, but avoid round-trip
  // drift while the user is actively dragging.
  const [hue, setHue] = useState(220);
  const [sat, setSat] = useState(0.8);
  const [val, setVal] = useState(0.95);
  const lastEmitted = useRef<string>("");

  useEffect(() => {
    if (!value || value === lastEmitted.current) return;
    const rgb = parseRgb(value);
    if (!rgb) return;
    const hsv = rgbToHsv(rgb);
    setHue(hsv.h);
    setSat(hsv.s);
    setVal(hsv.v);
  }, [value]);

  const emit = (h: number, s: number, v: number) => {
    const rgb = hsvToRgb({ h, s, v });
    const str = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    lastEmitted.current = str;
    onChange(str);
  };

  // ── 2D drag in the saturation/value plane ──────────────────────────────
  const svRef = useRef<HTMLDivElement | null>(null);
  const startSV = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = svRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const update = (cx: number, cy: number) => {
      const s = clamp01((cx - rect.left) / rect.width);
      const v = clamp01(1 - (cy - rect.top) / rect.height);
      setSat(s);
      setVal(v);
      emit(hue, s, v);
    };
    update(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── 1D drag on the hue strip ───────────────────────────────────────────
  const hueRef = useRef<HTMLDivElement | null>(null);
  const startHue = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = hueRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const update = (cx: number) => {
      const h = clamp01((cx - rect.left) / rect.width) * 360;
      setHue(h);
      emit(h, sat, val);
    };
    update(e.clientX);
    const move = (ev: PointerEvent) => update(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── Hex input ──────────────────────────────────────────────────────────
  const currentRgb = hsvToRgb({ h: hue, s: sat, v: val });
  const currentHex = rgbToHex(currentRgb);
  const [hexDraft, setHexDraft] = useState(currentHex.slice(1));
  // Keep the draft in sync when picker drives the hex.
  useEffect(() => {
    setHexDraft(currentHex.slice(1));
  }, [currentHex]);

  const commitHex = (raw: string) => {
    const clean = raw.trim().replace(/^#/, "");
    if (!/^[0-9a-f]{6}$/i.test(clean)) return false;
    const n = parseInt(clean, 16);
    const rgb = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    const hsv = rgbToHsv(rgb);
    setHue(hsv.h);
    setSat(hsv.s);
    setVal(hsv.v);
    emit(hsv.h, hsv.s, hsv.v);
    return true;
  };

  const currentColor = `rgb(${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b})`;
  const pureHue = `hsl(${hue}, 100%, 50%)`;

  return (
    <div className="cp">
      <div
        ref={svRef}
        className="cp-sv"
        style={{ background: pureHue }}
        onPointerDown={startSV}
      >
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <div
          className="cp-knob cp-sv-knob"
          style={{
            left: `${sat * 100}%`,
            top: `${(1 - val) * 100}%`,
            background: currentColor,
          }}
        />
      </div>

      <div ref={hueRef} className="cp-hue" onPointerDown={startHue}>
        <div
          className="cp-knob cp-hue-knob"
          style={{
            left: `${(hue / 360) * 100}%`,
            background: pureHue,
          }}
        />
      </div>

      <div className="cp-foot">
        <div className="cp-preview" style={{ background: currentColor }} />
        <div className="cp-hex">
          <span className="cp-hex-prefix">#</span>
          <input
            type="text"
            spellCheck={false}
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              commitHex(e.target.value);
            }}
            onBlur={() => {
              // If the field was left in a half-typed state, snap back to a
              // valid value derived from the current HSV.
              if (!commitHex(hexDraft)) setHexDraft(currentHex.slice(1));
            }}
            maxLength={6}
          />
        </div>
      </div>
    </div>
  );
}

// ── color math ───────────────────────────────────────────────────────────

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function parseRgb(s: string): Rgb | null {
  const parts = s.split(",").map((p) => parseInt(p.trim(), 10));
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]! };
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = (((gn - bn) / d) % 6 + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hh = ((h % 360) + 360) % 360 / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 1) { r1 = c; g1 = x; }
  else if (hh < 2) { r1 = x; g1 = c; }
  else if (hh < 3) { g1 = c; b1 = x; }
  else if (hh < 4) { g1 = x; b1 = c; }
  else if (hh < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = v - c;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return (
    "#" +
    [r, g, b]
      .map((n) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}
