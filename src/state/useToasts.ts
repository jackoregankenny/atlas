import { useCallback, useState } from "react";
import type { Toast } from "../components/Toasts";

let toastIdCounter = 1;

/** Toast stack state. `push` is stable so consumers can list it in deps. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Toast["kind"], text: string, ttl?: number) => {
    const id = toastIdCounter++;
    setToasts((t) => [...t, { id, kind, text, ttl }]);
  }, []);

  const dismiss = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    []
  );

  return { toasts, push, dismiss };
}

export type PushToast = ReturnType<typeof useToasts>["push"];
