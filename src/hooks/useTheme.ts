import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";

/** RGB triplet string like "139, 155, 255" or null = use theme default. */
export type AccentValue = string | null;

export interface AccentSwatch {
  id: string;
  label: string;
  /** Comma-separated RGB for use in CSS rgb()/rgba(). null = theme default. */
  rgb: AccentValue;
}

/** Convert "#RRGGBB" → "r, g, b" or null on parse failure. */
export function hexToRgb(hex: string): string | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Convert "r, g, b" → "#RRGGBB" with safe fallback. */
export function rgbToHex(rgb: AccentValue): string {
  if (!rgb) return "#5564eb";
  const parts = rgb.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length < 3 || parts.some(Number.isNaN)) return "#5564eb";
  return (
    "#" +
    parts
      .slice(0, 3)
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Visible swatches in the Settings picker. */
export const ACCENT_SWATCHES: AccentSwatch[] = [
  { id: "default", label: "Default", rgb: null },
  { id: "iris", label: "Iris", rgb: "139, 155, 255" },
  { id: "violet", label: "Violet", rgb: "181, 155, 255" },
  { id: "pink", label: "Pink", rgb: "236, 113, 168" },
  { id: "rose", label: "Rose", rgb: "239, 90, 110" },
  { id: "amber", label: "Amber", rgb: "230, 158, 60" },
  { id: "lime", label: "Lime", rgb: "126, 200, 80" },
  { id: "emerald", label: "Emerald", rgb: "60, 190, 130" },
  { id: "teal", label: "Teal", rgb: "60, 188, 198" },
  { id: "sky", label: "Sky", rgb: "70, 165, 240" },
];

const THEME_KEY = "atlas-theme-pref";
const ACCENT_KEY = "atlas-accent-pref";

function applyTheme(t: Theme) {
  const resolved =
    t === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : t;
  document.documentElement.setAttribute("data-theme", resolved);
}

function applyAccent(rgb: AccentValue) {
  const root = document.documentElement;
  if (rgb) root.style.setProperty("--accent-rgb", rgb);
  else root.style.removeProperty("--accent-rgb");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || "dark"
  );
  const [accent, setAccent] = useState<AccentValue>(
    () => localStorage.getItem(ACCENT_KEY) || null
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
    if (accent) localStorage.setItem(ACCENT_KEY, accent);
    else localStorage.removeItem(ACCENT_KEY);
  }, [accent]);

  const cycle = () => {
    setTheme((t) => (t === "dark" ? "light" : t === "light" ? "system" : "dark"));
  };

  return { theme, setTheme, cycle, accent, setAccent };
}
