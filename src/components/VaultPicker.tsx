import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Folder, HardDrive, X, Check } from "lucide-react";
import {
  cloudDriveSuggestions,
  setCurrentVault,
  validateVaultPath,
  type CloudSuggestion,
} from "../api";

interface Props {
  /** "welcome" on first run, "switch" when changing later. */
  mode: "welcome" | "switch";
  /** Current vault path so we can mark "in use" in the switch flow. */
  currentPath?: string | null;
  onClose: () => void;
  /** Called when the user picks a new vault; we expect the host to
   *  prompt-and-relaunch. Pass null to dismiss without changing. */
  onPicked: (path: string | null) => void;
}

/**
 * Vault picker modal. Two entry points:
 *   - first launch (no `vaults.json`): mode="welcome", no close
 *     escape — the user must pick something to continue.
 *   - Settings → Switch Vault: mode="switch", close cancels.
 *
 * Suggestions come from the Rust side and only include cloud drives
 * that actually exist on this machine, plus Documents. Nothing is
 * recommended that the user couldn't reach in Finder right now.
 */
export function VaultPicker({ mode, currentPath, onClose, onPicked }: Props) {
  const [suggestions, setSuggestions] = useState<CloudSuggestion[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasManifest, setHasManifest] = useState<boolean>(false);

  useEffect(() => {
    cloudDriveSuggestions().then(setSuggestions).catch(() => {});
  }, []);

  // Re-validate every time the user changes the pick. Tells us whether
  // the folder already contains a vault (existing library to open) or
  // would be a fresh start (folder created on first launch).
  useEffect(() => {
    if (!picked) {
      setHasManifest(false);
      setError(null);
      return;
    }
    validateVaultPath(picked)
      .then((v) => {
        setHasManifest(v.has_manifest);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [picked]);

  const onBrowse = async () => {
    try {
      const sel = await openDialog({ directory: true, multiple: false });
      if (typeof sel === "string") setPicked(sel);
    } catch (e) {
      setError(String(e));
    }
  };

  const onConfirm = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      // The backend swaps the vault in place (no restart): it re-roots
      // the manifest writer and reconciles any existing vault manifest,
      // emitting `library-updated` when books arrive.
      await setCurrentVault(picked);
      onPicked(picked);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const dismissable = mode === "switch";

  return (
    <div
      className="vault-backdrop"
      onClick={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="vault-panel"
        role="dialog"
        aria-label={mode === "welcome" ? "Welcome to Atlas" : "Switch vault"}
      >
        <header className="vault-head">
          <div>
            <h2 className="vault-title">
              {mode === "welcome"
                ? "Where should Atlas keep your books?"
                : "Switch vault"}
            </h2>
            <p className="vault-sub">
              Atlas stores your library — books, progress, highlights — in a
              single folder. Put it in iCloud, Dropbox, or Syncthing to
              follow you across devices.
            </p>
          </div>
          {dismissable && (
            <button className="icon-btn" onClick={onClose} title="Cancel">
              <X size={14} strokeWidth={2.2} />
            </button>
          )}
        </header>

        <div className="vault-section-title">Suggested locations</div>
        <ul className="vault-list">
          {suggestions.map((s) => {
            const isPicked = picked === s.suggested;
            const isCurrent = currentPath === s.suggested;
            return (
              <li key={s.suggested}>
                <button
                  className={`vault-item ${isPicked ? "picked" : ""}`}
                  onClick={() => setPicked(s.suggested)}
                >
                  <span className="vault-item-icon">
                    {s.label === "Documents" ? (
                      <Folder size={14} strokeWidth={2} />
                    ) : (
                      <HardDrive size={14} strokeWidth={2} />
                    )}
                  </span>
                  <span className="vault-item-text">
                    <span className="vault-item-label">{s.label}</span>
                    <span className="vault-item-path">{s.suggested}</span>
                  </span>
                  {isCurrent && (
                    <span className="vault-item-badge">In use</span>
                  )}
                  {isPicked && (
                    <Check size={13} strokeWidth={2.4} className="vault-item-tick" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="vault-or">or</div>

        <button className="vault-browse" onClick={onBrowse}>
          <Folder size={14} strokeWidth={2} />
          <span>Choose another folder…</span>
        </button>

        {picked && (
          <div className={`vault-preview ${hasManifest ? "preview-existing" : ""}`}>
            <div className="vault-preview-path">{picked}</div>
            <div className="vault-preview-msg">
              {hasManifest
                ? "✓ Existing Atlas vault — your books, highlights, and progress will sync from here."
                : "New vault — Atlas will create this folder and start fresh."}
            </div>
          </div>
        )}

        {error && <div className="vault-error">{error}</div>}

        <div className="vault-actions">
          {dismissable && (
            <button className="vault-cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          <button
            className="primary vault-confirm"
            onClick={onConfirm}
            disabled={!picked || busy}
          >
            {busy
              ? "Switching…"
              : mode === "welcome"
                ? "Open vault"
                : "Switch & relaunch"}
          </button>
        </div>
      </div>
    </div>
  );
}
