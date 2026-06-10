import { useEffect, useState } from "react";
import { Check, Loader2, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { appPaths } from "../api";
import type { UpdateStatus } from "../state/useUpdater";
import {
  type Theme,
  type AccentValue,
  ACCENT_SWATCHES,
} from "../hooks/useTheme";
import type { useUiPrefs, ChromeStyle } from "../hooks/useUiPrefs";
import { Popover } from "./Popover";
import { ColorPicker } from "./ColorPicker";

interface Props {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: AccentValue;
  setAccent: (v: AccentValue) => void;
  ui: ReturnType<typeof useUiPrefs>;
  onExportAllAnnotations: () => void;
  onSwitchVault: () => void;
  updateStatus: UpdateStatus;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
}

export function SettingsView({
  theme,
  setTheme,
  accent,
  setAccent,
  ui,
  onExportAllAnnotations,
  onSwitchVault,
  updateStatus,
  onCheckUpdates,
  onInstallUpdate,
}: Props) {
  const [currentVault, setCurrentVault] = useState<string>("");
  useEffect(() => {
    appPaths()
      .then((p) => setCurrentVault(p.library_root))
      .catch(() => {});
  }, []);
  return (
    <div className="settings-page">
      <div className="settings-titlebar" data-tauri-drag-region />
      <div className="settings-wrap">
        <h2>Settings</h2>

        <section className="settings-section">
          <h3>Vault</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Current vault</div>
              <div className="settings-desc">
                Atlas stores your library here. Put this folder in iCloud,
                Dropbox, or Syncthing to follow you across devices.
              </div>
              <div className="settings-path">{currentVault || "…"}</div>
            </div>
            <button className="settings-btn" onClick={onSwitchVault}>
              Switch…
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Theme</div>
              <div className="settings-desc">
                Dark, light, or match your system preference.
              </div>
            </div>
            <div className="seg">
              {(["dark", "light", "system"] as Theme[]).map((t) => (
                <button
                  key={t}
                  className={theme === t ? "active" : ""}
                  onClick={() => setTheme(t)}
                >
                  {t === "dark" ? (
                    <Moon size={13} strokeWidth={2} />
                  ) : t === "light" ? (
                    <Sun size={13} strokeWidth={2} />
                  ) : (
                    <Monitor size={13} strokeWidth={2} />
                  )}
                  <span>{t[0]!.toUpperCase() + t.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">Accent color</div>
              <div className="settings-desc">
                Used for primary buttons, status, focus rings, and active
                states throughout the app.
              </div>
            </div>
            <div className="swatch-row">
              {ACCENT_SWATCHES.map((s) => {
                const isActive = (accent ?? null) === s.rgb;
                return (
                  <button
                    key={s.id}
                    className={`swatch ${isActive ? "active" : ""}`}
                    style={s.rgb ? { background: `rgb(${s.rgb})` } : undefined}
                    onClick={() => setAccent(s.rgb)}
                    title={s.label}
                    aria-label={s.label}
                  >
                    {!s.rgb && <Check size={11} strokeWidth={2.6} />}
                    {isActive && s.rgb && <Check size={11} strokeWidth={2.6} />}
                  </button>
                );
              })}
              {(() => {
                const isCustom =
                  !!accent && !ACCENT_SWATCHES.some((s) => s.rgb === accent);
                return (
                  <Popover
                    align="end"
                    trigger={
                      <button
                        className={`swatch swatch-custom ${isCustom ? "active" : ""}`}
                        style={
                          isCustom ? { background: `rgb(${accent})` } : undefined
                        }
                        title="Custom color"
                        aria-label="Custom color"
                      >
                        {isCustom ? (
                          <Check size={11} strokeWidth={2.6} />
                        ) : (
                          <span className="swatch-custom-glyph" aria-hidden />
                        )}
                      </button>
                    }
                  >
                    {() => (
                      <ColorPicker
                        value={accent}
                        onChange={(rgb) => setAccent(rgb)}
                      />
                    )}
                  </Popover>
                );
              })()}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Interface</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Button style</div>
              <div className="settings-desc">
                Soft 3D uses gradients and depth. Flat is a single fill, no
                shadows — quieter and easier on the eyes.
              </div>
            </div>
            <div className="seg">
              {(
                [
                  { id: "soft", label: "Soft 3D" },
                  { id: "flat", label: "Flat" },
                ] as { id: ChromeStyle; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  className={ui.prefs.chrome === opt.id ? "active" : ""}
                  onClick={() => ui.setChrome(opt.id)}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">Visual flourishes</div>
              <div className="settings-desc">
                Idle book drift, paper grain, hero color glow, and hover lifts.
                Turn off for a calmer, more utilitarian interface.
              </div>
            </div>
            <div className="seg">
              <button
                className={ui.prefs.flourishes ? "active" : ""}
                onClick={() => ui.setFlourishes(true)}
              >
                <span>On</span>
              </button>
              <button
                className={!ui.prefs.flourishes ? "active" : ""}
                onClick={() => ui.setFlourishes(false)}
              >
                <span>Off</span>
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Annotations</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">Export all annotations</div>
              <div className="settings-desc">
                Save every highlight + note across your library as one
                Markdown file (Readwise format).
              </div>
            </div>
            <button className="seg" onClick={onExportAllAnnotations}>
              Export…
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Updates</h3>
          <div className="settings-row">
            <div>
              <div className="settings-label">
                {updateStatus.kind === "available"
                  ? `Atlas ${updateStatus.version} is available`
                  : updateStatus.kind === "downloading"
                    ? `Downloading…${updateStatus.percent != null ? ` ${updateStatus.percent}%` : ""}`
                    : updateStatus.kind === "ready"
                      ? "Restarting into the new version…"
                      : updateStatus.kind === "uptodate"
                        ? "You're on the latest version"
                        : "Check for updates"}
              </div>
              <div className="settings-desc">
                Updates download from GitHub releases and install in place.
              </div>
            </div>
            {updateStatus.kind === "available" ? (
              <button className="settings-btn" onClick={onInstallUpdate}>
                Install &amp; restart
              </button>
            ) : updateStatus.kind === "downloading" ||
              updateStatus.kind === "ready" ? (
              <button className="settings-btn" disabled>
                <Loader2 size={13} className="spin" />
              </button>
            ) : (
              <button
                className="settings-btn"
                onClick={onCheckUpdates}
                disabled={updateStatus.kind === "checking"}
              >
                {updateStatus.kind === "checking" ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <RefreshCw size={13} strokeWidth={2} />
                )}
                <span>Check now</span>
              </button>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h3>About</h3>
          <p className="muted">Atlas v0.1 · local-first EPUB library</p>
        </section>
      </div>
    </div>
  );
}
