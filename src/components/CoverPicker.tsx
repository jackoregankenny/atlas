import { useEffect, useState } from "react";
import { Check, ImageOff, Loader2 } from "lucide-react";
import {
  coverCandidates,
  setBookCover,
  type CoverCandidate,
} from "../api";

interface Props {
  bookId: number;
  /** Called after the cover has been successfully replaced. */
  onChanged: () => void;
  close: () => void;
}

type Status = "loading" | "ready" | "empty" | "error";

export function CoverPicker({ bookId, onChanged, close }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<CoverCandidate[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    coverCandidates(bookId)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
        setStatus(rows.length === 0 ? "empty" : "ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const pick = async (c: CoverCandidate) => {
    if (picking) return;
    setPicking(c.url);
    try {
      await setBookCover(bookId, c.url);
      onChanged();
      close();
    } catch {
      setPicking(null);
    }
  };

  const visible = items.filter((c) => !failed.has(c.thumb_url));

  return (
    <div className="menu cover-picker">
      <div className="cover-picker-header">
        <span className="cover-picker-title">Choose cover</span>
        {status === "ready" && (
          <span className="cover-picker-count">{visible.length}</span>
        )}
      </div>
      {status === "loading" && (
        <div className="cover-picker-state">
          <Loader2 size={14} className="spin" />
          <span>Searching covers…</span>
        </div>
      )}
      {status === "error" && (
        <div className="cover-picker-state">
          <ImageOff size={14} />
          <span>Couldn't load covers.</span>
        </div>
      )}
      {(status === "empty" || (status === "ready" && visible.length === 0)) && (
        <div className="cover-picker-state">
          <ImageOff size={14} />
          <span>No alternate covers found.</span>
        </div>
      )}
      {status === "ready" && visible.length > 0 && (
        <div className="cover-picker-grid">
          {visible.map((c) => (
            <button
              key={c.url}
              className={`cover-picker-tile ${picking === c.url ? "loading" : ""}`}
              onClick={() => pick(c)}
              title={c.source}
              disabled={picking !== null}
            >
              <img
                src={c.thumb_url}
                alt=""
                loading="lazy"
                draggable={false}
                onError={() =>
                  setFailed((s) => {
                    const next = new Set(s);
                    next.add(c.thumb_url);
                    return next;
                  })
                }
              />
              {picking === c.url && (
                <span className="cover-picker-tile-spinner">
                  <Loader2 size={16} className="spin" />
                </span>
              )}
              <span className="cover-picker-tile-check">
                <Check size={12} strokeWidth={3} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
