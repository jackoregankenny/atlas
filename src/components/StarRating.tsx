import { useState } from "react";
import { Star } from "lucide-react";

interface Props {
  value: number | null;
  onChange: (v: number | null) => void;
  size?: number;
}

export function StarRating({ value, onChange, size = 16 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <div
      className="star-rating"
      role="radiogroup"
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= shown;
        return (
          <button
            key={n}
            className={`star-btn ${filled ? "filled" : ""}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(value === n ? null : n)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
          >
            <Star
              size={size}
              strokeWidth={1.6}
              fill={filled ? "currentColor" : "none"}
            />
          </button>
        );
      })}
    </div>
  );
}
