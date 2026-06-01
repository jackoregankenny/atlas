import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowDownToLine } from "lucide-react";

interface Props {
  onDrop: (paths: string[]) => void;
}

export function DropZone({ onDrop }: Props) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over" || event.payload.type === "enter") {
          setOver(true);
        } else if (event.payload.type === "leave") {
          setOver(false);
        } else if (event.payload.type === "drop") {
          setOver(false);
          const paths = (event.payload.paths ?? []).map((p) => String(p));
          if (paths.length > 0) onDrop(paths);
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [onDrop]);

  if (!over) return null;
  return (
    <div className="dropzone">
      <div className="dropzone-inner">
        <ArrowDownToLine size={36} strokeWidth={1.5} className="dropzone-icon" />
        <div className="dropzone-text">Drop to import</div>
        <div className="dropzone-sub">EPUBs or a folder</div>
      </div>
    </div>
  );
}
