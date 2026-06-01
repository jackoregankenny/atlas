import { useState } from "react";
import { coverUrl } from "../api";

interface Props {
  path: string | null;
  title: string;
  size?: "card" | "detail" | "palette";
}

export function Cover({ path, title, size = "card" }: Props) {
  const src = coverUrl(path);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div className={`cover-fallback cover-${size}`}>
        <span>{title.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className={`cover-img-wrap cover-${size}`}>
      {!loaded && <div className="cover-skeleton" />}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className={`cover-img ${loaded ? "loaded" : ""}`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </div>
  );
}
