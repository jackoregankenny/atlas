import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface Pos {
  x: number;
  y: number;
}

interface SubmenuCtxValue {
  active: string | null;
  setActive: (id: string | null) => void;
}
export const SubmenuCtx = createContext<SubmenuCtxValue>({
  active: null,
  setActive: () => {},
});

interface Props {
  pos: Pos | null;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ pos, onClose, children }: Props) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [adj, setAdj] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    if (!pos || !popRef.current) {
      setAdj(null);
      return;
    }
    const r = popRef.current.getBoundingClientRect();
    const margin = 6;
    let x = pos.x;
    let y = pos.y;
    if (x + r.width + margin > window.innerWidth)
      x = window.innerWidth - r.width - margin;
    if (y + r.height + margin > window.innerHeight)
      y = window.innerHeight - r.height - margin;
    setAdj({ x: Math.max(margin, x), y: Math.max(margin, y) });
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    function isInsideAnyMenu(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if (popRef.current?.contains(el)) return true;
      return !!el.closest?.(".popover");
    }
    function onDown(e: MouseEvent) {
      if (isInsideAnyMenu(e.target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    function onContext(e: MouseEvent) {
      if (!isInsideAnyMenu(e.target)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("contextmenu", onContext, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("contextmenu", onContext, true);
    };
  }, [pos, onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={popRef}
      className="popover ctx-menu"
      style={{
        position: "fixed",
        top: adj?.y ?? -9999,
        left: adj?.x ?? -9999,
        visibility: adj ? "visible" : "hidden",
        zIndex: 9999,
      }}
      role="menu"
    >
      <SubmenuProvider>{children}</SubmenuProvider>
    </div>,
    document.body
  );
}

export function SubmenuProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return <SubmenuCtx.Provider value={value}>{children}</SubmenuCtx.Provider>;
}

interface SubmenuProps {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function Submenu({ label, icon, children }: SubmenuProps) {
  const id = useId();
  const ctx = useContext(SubmenuCtx);
  const open = ctx.active === id;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  // Hover behavior: close the previous submenu *immediately* and switch.
  // No delay — delay was causing the appearance of overlap.
  const handleEnter = () => {
    if (ctx.active !== id) ctx.setActive(id);
  };
  const handleClick = () => {
    ctx.setActive(open ? null : id);
  };

  // Single positioning pass: measure after mount, pick the side, clamp.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    if (!triggerRef.current || !subRef.current) return;

    const trig = triggerRef.current.getBoundingClientRect();
    const sub = subRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 2;

    // Position relative to the parent menu, not just the trigger row, so
    // submenus from a right-aligned panel still find room on the left.
    const parentMenu = triggerRef.current.closest(".popover") as HTMLElement | null;
    const parent = parentMenu?.getBoundingClientRect();

    const rightAnchor = parent ? parent.right : trig.right;
    const leftAnchor = parent ? parent.left : trig.left;

    let x = rightAnchor + gap;
    const roomRight = window.innerWidth - rightAnchor - gap;
    const roomLeft = leftAnchor - gap;

    if (sub.width > roomRight) {
      // Not enough room on the right — flip if it fits left, else use whichever
      // side has more room.
      if (sub.width <= roomLeft) {
        x = leftAnchor - sub.width - gap;
      } else if (roomLeft > roomRight) {
        x = Math.max(margin, leftAnchor - sub.width - gap);
      }
      // else stay on the right; the clamp below will bring it into view.
    }

    // Final horizontal clamp.
    x = Math.max(margin, Math.min(window.innerWidth - sub.width - margin, x));

    let y = trig.top - 4;
    if (y + sub.height + margin > window.innerHeight) {
      y = window.innerHeight - sub.height - margin;
    }
    y = Math.max(margin, y);

    setPos({ x, y });
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className={`menu-item submenu-trigger ${open ? "open" : ""}`}
        onMouseEnter={handleEnter}
        onFocus={handleEnter}
        onClick={handleClick}
      >
        {icon && <span className="menu-item-icon">{icon}</span>}
        <span className="menu-item-label">{label}</span>
        <span className="submenu-chevron">›</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={subRef}
            className="popover ctx-menu"
            style={{
              position: "fixed",
              top: pos?.y ?? -9999,
              left: pos?.x ?? -9999,
              visibility: pos ? "visible" : "hidden",
              zIndex: 10000,
            }}
            role="menu"
            onMouseEnter={() => {
              if (ctx.active !== id) ctx.setActive(id);
            }}
          >
            <SubmenuProvider>{children}</SubmenuProvider>
          </div>,
          document.body
        )}
    </>
  );
}
