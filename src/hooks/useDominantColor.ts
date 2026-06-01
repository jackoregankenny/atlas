import { useEffect, useState } from "react";
import { coverUrl } from "../api";
import { extractDominantColor, type Rgb } from "../util/dominantColor";

export function useDominantColor(coverPath: string | null): Rgb | null {
  const [color, setColor] = useState<Rgb | null>(null);
  useEffect(() => {
    if (!coverPath) {
      setColor(null);
      return;
    }
    const src = coverUrl(coverPath);
    if (!src) return;
    let cancelled = false;
    extractDominantColor(src).then((c) => {
      if (!cancelled) setColor(c);
    });
    return () => {
      cancelled = true;
    };
  }, [coverPath]);
  return color;
}
