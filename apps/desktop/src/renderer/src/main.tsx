import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initTheme } from "./lib/theme";
import "./styles/app.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

// Paint the stored palette before first render (no theme flash).
initTheme();

// React's DEV build ("Performance Tracks") emits a `performance.measure` per
// component render. Those entries live forever in the browser's performance
// buffer — a heavy streaming session accumulates ~1M of them (100MB+ and
// climbing), which was the real driver of dev memory growth + GC jank, NOT the
// markdown layer. React's PRODUCTION build strips this instrumentation, so this
// guard is dev-only. We can't disable React's emission, so we cap the buffer by
// clearing it periodically; modus never reads performance entries, so this is
// side-effect-free.
if (import.meta.env.DEV) {
  window.setInterval(() => {
    performance.clearMeasures();
    performance.clearMarks();
  }, 1500);
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
