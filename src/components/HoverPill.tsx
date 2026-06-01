import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  children: React.ReactNode;
  /** CSS selector for hoverable targets within children. */
  selector?: string;
  /** Skip targets matching this selector (e.g. ".active"). */
  skip?: string;
  /** Selector for the currently-active element to render a sliding indicator behind. */
  activeSelector?: string;
  className?: string;
}

/**
 * Renders an absolutely-positioned highlight that follows whichever
 * element matching `selector` is currently hovered. The pill springs
 * between positions and fades in/out at the edges of the container.
 *
 * If `activeSelector` is given, also renders a persistent pill behind
 * the matching element and animates between positions when it changes.
 */
export function HoverPill({
  children,
  selector = "button",
  skip,
  activeSelector,
  className = "",
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);
  const [activeRect, setActiveRect] = useState<Rect | null>(null);
  // Skip the spring on the very first measurement so it doesn't fly in.
  const [activeReady, setActiveReady] = useState(false);

  const measureActive = () => {
    const wrap = wrapRef.current;
    if (!wrap || !activeSelector) return;
    const target = wrap.querySelector(activeSelector) as HTMLElement | null;
    if (!target) {
      setActiveRect(null);
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    setActiveRect({
      top: tr.top - wr.top + wrap.scrollTop,
      left: tr.left - wr.left + wrap.scrollLeft,
      width: tr.width,
      height: tr.height,
    });
  };

  useLayoutEffect(() => {
    measureActive();
    // Two frames so layout settles before we mark "ready" → enables transitions.
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setActiveReady(true))
    );
    return () => cancelAnimationFrame(id);
    // Re-measure whenever children change (active class moves, items added).
  }, [children, activeSelector]);

  useEffect(() => {
    if (!activeSelector) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => measureActive());
    ro.observe(wrap);
    const mo = new MutationObserver(() => measureActive());
    mo.observe(wrap, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
    });
    const onScroll = () => measureActive();
    wrap.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      wrap.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSelector]);

  const handleOver = (e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const target = (e.target as HTMLElement).closest(selector) as HTMLElement | null;
    if (!target || !wrap.contains(target)) return;
    if (skip && target.matches(skip)) {
      setVisible(false);
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    setRect({
      top: tr.top - wr.top + wrap.scrollTop,
      left: tr.left - wr.left + wrap.scrollLeft,
      width: tr.width,
      height: tr.height,
    });
    setVisible(true);
  };

  const handleLeave = () => setVisible(false);

  return (
    <div
      ref={wrapRef}
      className={`hover-pill-wrap ${className}`}
      onMouseOver={handleOver}
      onMouseLeave={handleLeave}
    >
      {activeRect && (
        <div
          className={`active-pill ${activeReady ? "ready" : ""}`}
          style={{
            transform: `translate(${activeRect.left}px, ${activeRect.top}px)`,
            width: activeRect.width,
            height: activeRect.height,
          }}
          aria-hidden
        />
      )}
      {rect && (
        <div
          className={`hover-pill ${visible ? "visible" : ""}`}
          style={{
            transform: `translate(${rect.left}px, ${rect.top}px)`,
            width: rect.width,
            height: rect.height,
          }}
          aria-hidden
        />
      )}
      {children}
    </div>
  );
}
