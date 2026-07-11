import "@fontsource-variable/inter";
import { StrictMode, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { reportRendererStartup } from "./app/startup-report";
import { initTheme } from "./lib/theme";
import "./styles/app.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

function StartupCommitReporter() {
  const reported = useRef(false);

  useLayoutEffect(() => {
    if (reported.current) {
      return;
    }
    reported.current = true;
    reportRendererStartup("renderer.first-commit");
  }, []);

  return null;
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
    <StartupCommitReporter />
    <App />
  </StrictMode>,
);
