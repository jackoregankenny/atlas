import { useCallback, useEffect, useState } from "react";
import { listDevices } from "../api";
import type { Device } from "../types";

const POLL_MS = 4000;

export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);

  const refresh = useCallback(async () => {
    try {
      const d = await listDevices();
      setDevices((prev) => {
        // Avoid identity churn if nothing changed (cheap shallow compare).
        if (
          prev.length === d.length &&
          prev.every((p, i) => p.id === d[i]!.id)
        ) {
          return prev;
        }
        return d;
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  return { devices, refresh };
}
