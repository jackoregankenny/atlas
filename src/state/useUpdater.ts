import { useCallback, useEffect, useRef, useState } from "react";
import type { PushToast } from "./useToasts";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; percent: number | null }
  | { kind: "ready" }
  | { kind: "uptodate" };

/**
 * GitHub-releases auto-updater. Checks quietly on startup (a toast only if
 * something is available); Settings exposes a manual check + install. The
 * download streams in-place and the app relaunches into the new version.
 * Outside Tauri (browser preview) every call is a silent no-op.
 */
export function useUpdater(pushToast: PushToast) {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  // The plugin's Update object; held between check and install.
  const updateRef = useRef<import("@tauri-apps/plugin-updater").Update | null>(null);

  const check = useCallback(
    async (opts?: { quiet?: boolean }) => {
      setStatus({ kind: "checking" });
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update) {
          updateRef.current = update;
          setStatus({ kind: "available", version: update.version });
          pushToast("info", `Atlas ${update.version} is available — install from Settings.`, 8000);
        } else {
          updateRef.current = null;
          setStatus({ kind: "uptodate" });
          if (!opts?.quiet) pushToast("success", "Atlas is up to date.");
        }
      } catch (e) {
        setStatus({ kind: "idle" });
        // Offline or running unbundled (tauri dev) — only worth a toast
        // when the user asked explicitly.
        if (!opts?.quiet) pushToast("error", `Update check failed: ${e}`);
      }
    },
    [pushToast]
  );

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setStatus({ kind: "downloading", percent: null });
    try {
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total) {
            setStatus({
              kind: "downloading",
              percent: Math.round((received / total) * 100),
            });
          }
        } else if (event.event === "Finished") {
          setStatus({ kind: "ready" });
        }
      });
      pushToast("success", "Update installed — restarting…", 4000);
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setStatus({ kind: "available", version: update.version });
      pushToast("error", `Update failed: ${e}`);
    }
  }, [pushToast]);

  // One quiet check shortly after launch. Never blocks startup.
  const didCheck = useRef(false);
  useEffect(() => {
    if (didCheck.current) return;
    didCheck.current = true;
    const t = setTimeout(() => check({ quiet: true }), 4000);
    return () => clearTimeout(t);
  }, [check]);

  return { status, check, install };
}
