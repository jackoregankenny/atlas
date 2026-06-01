import {
  cloneElement,
  isValidElement,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SubmenuCtx, SubmenuProvider } from "./ContextMenu";

type Align = "start" | "center" | "end";
type Side = "bottom" | "top";

interface Props {
  trigger: ReactElement;
  children: (close: () => void) => ReactNode;
  align?: Align;
  side?: Side;
  offset?: number;
}

interface Pos { top: number; left: number; }

export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  offset = 6,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popRef.current) return;
    const trig = triggerRef.current.getBoundingClientRect();
    const pop = popRef.current.getBoundingClientRect();

    let top =
      side === "bottom"
        ? trig.bottom + offset
        : trig.top - pop.height - offset;
    let left =
      align === "start"
        ? trig.left
        : align === "end"
        ? trig.right - pop.width
        : trig.left + trig.width / 2 - pop.width / 2;

    // viewport clamp
    const margin = 8;
    left = Math.max(margin, Math.min(window.innerWidth - pop.width - margin, left));
    top = Math.max(margin, Math.min(window.innerHeight - pop.height - margin, top));

    setPos({ top, left });
  }, [open, align, side, offset]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (popRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      // Submenus & nested popovers are portaled — keep the parent open while
      // the user interacts with them.
      if (t.closest?.(".popover")) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!isValidElement(trigger)) {
    throw new Error("Popover trigger must be a valid React element");
  }

  const triggerEl = cloneElement(trigger as ReactElement<any>, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
    },
    onClick: (e: React.MouseEvent) => {
      (trigger.props as any).onClick?.(e);
      setOpen((v) => !v);
    },
    "aria-expanded": open,
  });

  return (
    <>
      {triggerEl}
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="popover"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              visibility: pos ? "visible" : "hidden",
              zIndex: 9999,
            }}
            role="menu"
          >
            <SubmenuProvider>{children(close)}</SubmenuProvider>
          </div>,
          document.body
        )}
    </>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}

export function MenuItem({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  danger,
  active,
}: MenuItemProps) {
  const ctx = useContext(SubmenuCtx);
  return (
    <button
      className={`menu-item ${danger ? "danger" : ""} ${active ? "active" : ""}`}
      onClick={onClick}
      onMouseEnter={() => {
        // Hovering a plain menu item should close any open sibling submenu.
        if (ctx.active !== null) ctx.setActive(null);
      }}
      disabled={disabled}
      role="menuitem"
    >
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-label">{label}</span>
      {shortcut && <kbd className="kbd menu-item-kbd">{shortcut}</kbd>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}
