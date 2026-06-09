import { useEffect } from "react";
import { X } from "lucide-react";
import { HELP_GROUPS } from "../shortcuts";

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
          {HELP_GROUPS.map((g) => (
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
