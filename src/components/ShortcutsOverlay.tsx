import { useEffect } from "react";
import { X } from "lucide-react";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

const GROUPS: { name: string; items: { keys: string; label: string }[] }[] = [
  {
    name: "Navigation",
    items: [
      { keys: `${MOD} K`, label: "Open command palette" },
      { keys: "/", label: "Focus filter" },
      { keys: "g l", label: "Go to library" },
      { keys: "g s", label: "Go to settings" },
      { keys: "?", label: "Show shortcuts" },
      { keys: "Esc", label: "Close overlay / back" },
    ],
  },
  {
    name: "Library",
    items: [
      { keys: "v", label: "Cycle view (grid · compact · list)" },
      { keys: "s", label: "Open sort menu" },
      { keys: `${MOD} I`, label: "Import files" },
      { keys: `${MOD} ⇧ I`, label: "Import folder" },
      { keys: "t", label: "Cycle theme" },
    ],
  },
  {
    name: "Reader",
    items: [
      { keys: "← / →", label: "Previous / next page" },
      { keys: "Space", label: "Next page" },
      { keys: "j / k", label: "Next / previous page" },
      { keys: "Esc", label: "Close reader" },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <header className="shortcuts-head">
          <h2>Keyboard Shortcuts</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </header>
        <div className="shortcuts-grid">
          {GROUPS.map((g) => (
            <section key={g.name}>
              <div className="shortcuts-group-title">{g.name}</div>
              {g.items.map((item) => (
                <div className="shortcut-row" key={item.label}>
                  <span>{item.label}</span>
                  <span className="shortcut-keys">
                    {item.keys.split(" ").map((k, i) => (
                      <kbd key={i} className="kbd">
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
