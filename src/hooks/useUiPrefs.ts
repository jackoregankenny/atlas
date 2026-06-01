import { useEffect, useState } from "react";

export type ChromeStyle = "soft" | "flat";

export interface UiPrefs {
  /** Button / surface treatment. "soft" = gradient + shadow + bevel; "flat" = single fill, single border, no shadow. */
  chrome: ChromeStyle;
  /** Master switch for non-essential motion + decoration: idle book drift,
   *  paper grain, hero gradient tint, hover lifts, rim/specular. */
  flourishes: boolean;
}

const KEY = "atlas-ui-prefs-v1";
const DEFAULTS: UiPrefs = { chrome: "soft", flourishes: true };

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw);
    return {
      chrome: v.chrome === "flat" ? "flat" : "soft",
      flourishes: v.flourishes !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

function apply(p: UiPrefs) {
  const root = document.documentElement;
  root.setAttribute("data-chrome", p.chrome);
  root.setAttribute("data-flourishes", p.flourishes ? "on" : "off");
}

// Apply once at module load so the very first paint matches the stored prefs
// instead of flashing the defaults.
if (typeof document !== "undefined") apply(load());

export function useUiPrefs() {
  const [prefs, setPrefs] = useState<UiPrefs>(load);

  useEffect(() => {
    apply(prefs);
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);

  return {
    prefs,
    setChrome: (chrome: ChromeStyle) =>
      setPrefs((p) => ({ ...p, chrome })),
    setFlourishes: (flourishes: boolean) =>
      setPrefs((p) => ({ ...p, flourishes })),
  };
}
