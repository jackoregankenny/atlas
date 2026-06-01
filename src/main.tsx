import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Record the host platform so CSS can target it. We previously also opted
// the macOS/Windows webview into translucency via data-vibrancy="on", but
// that path required `transparent: true` on the window which broke window
// dragging on macOS — so vibrancy is currently disabled in favor of working
// drag + a solid backing. If we want it back, set transparent: true +
// macOSPrivateApi: true in tauri.conf.json AND re-enable the attribute here.
{
  const ua = navigator.userAgent;
  const platform =
    /Mac/i.test(ua) ? "macos" : /Windows/i.test(ua) ? "windows" : "linux";
  document.documentElement.setAttribute("data-platform", platform);
}

// Window dragging is handled by tauri-plugin-decorum (see src-tauri/src/lib.rs)
// which installs a proper draggable overlay titlebar on macOS — works around
// Tauri issue #9503.

// Respect prefers-reduced-motion: turn off Book3D idle drift + decorative
// flourishes (Book3D.tsx checks data-flourishes; CSS handles transitions).
{
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  const apply = () => {
    document.documentElement.setAttribute(
      "data-flourishes",
      mql.matches ? "off" : "on"
    );
  };
  apply();
  mql.addEventListener("change", apply);
}

const warmReader = () => {
  void import("./components/Reader");
};
if ("requestIdleCallback" in window) {
  (window as Window & typeof globalThis).requestIdleCallback(warmReader, { timeout: 2000 });
} else {
  setTimeout(warmReader, 1500);
}
