import type { WebContents } from "electron";
import { OverlayInjector } from "./overlay-injector";

/**
 * Visual presence for agent-driven browsing (the Codex-app interaction model):
 * while the agent controls a tab, the viewport gets a breathing glow ring and
 * an animated AI cursor flies to each action target before the trusted CDP
 * input fires, so the user can follow what the agent is doing in real time.
 *
 * Implementation notes — chosen for zero page pollution and minimal overhead:
 * - The overlay runs in an ISOLATED WORLD (`executeJavaScriptInIsolatedWorld`),
 *   so the page's own JavaScript never sees our globals.
 * - Styles go through `webContents.insertCSS` (browser-privileged, immune to
 *   the page's CSP); the overlay nodes carry `role="presentation"` +
 *   `aria-hidden`, which keeps them out of the accessibility tree and
 *   therefore out of browser_snapshot results.
 * - All motion is Web Animations API on `transform`/`opacity` only —
 *   compositor-thread animation, no layout, no paint storms.
 * - Coordinates are root-viewport CSS pixels, the same space used by CDP
 *   input and screenshots, so the cursor lands exactly where the click does.
 * - Screenshots temporarily hide the overlay so the model never mistakes the
 *   agent cursor for page UI.
 */

const WORLD_ID = 1559;

export type CursorAction = "click" | "hover" | "drag" | "input" | "scroll";

const OVERLAY_CSS = `
.modus-agent-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; opacity: 1; transition: opacity 120ms linear; }
.modus-agent-overlay__glow { position: absolute; inset: 0; opacity: 0; transition: opacity 300ms ease; }
.modus-agent-overlay--active .modus-agent-overlay__glow { opacity: 1; animation: modus-agent-overlay-breathe 1.6s ease-in-out infinite; }
@keyframes modus-agent-overlay-breathe {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(133, 63, 244, 0.95), inset 0 0 18px 4px rgba(133, 63, 244, 0.3); }
  50% { box-shadow: inset 0 0 0 4px rgba(179, 136, 255, 0.95), inset 0 0 46px 10px rgba(133, 63, 244, 0.55); }
}
.modus-agent-overlay__cursor, .modus-agent-overlay__trail { position: absolute; left: 0; top: 0; width: 22px; height: 22px; opacity: 0; will-change: transform; transition: opacity 200ms ease; }
.modus-agent-overlay__cursor { filter: drop-shadow(0 2px 5px rgba(10, 6, 24, 0.4)); }
.modus-agent-overlay--active .modus-agent-overlay__cursor { opacity: 1; animation: modus-agent-overlay-cursor-flicker 1.6s ease-in-out infinite; }
@keyframes modus-agent-overlay-cursor-flicker {
  0%, 100% { opacity: 0.96; filter: drop-shadow(0 2px 5px rgba(10, 6, 24, 0.4)) drop-shadow(0 0 2px rgba(133, 63, 244, 0.35)); }
  50% { opacity: 0.7; filter: drop-shadow(0 2px 5px rgba(10, 6, 24, 0.4)) drop-shadow(0 0 8px rgba(179, 136, 255, 0.95)); }
}
.modus-agent-overlay--active .modus-agent-overlay__trail[data-trail="0"] { opacity: 0.38; }
.modus-agent-overlay--active .modus-agent-overlay__trail[data-trail="1"] { opacity: 0.2; }
.modus-agent-overlay--active .modus-agent-overlay__trail[data-trail="2"] { opacity: 0.09; }
.modus-agent-overlay__ripple { position: absolute; left: -16px; top: -16px; width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(179, 136, 255, 0.9); background: rgba(133, 63, 244, 0.18); }
`;

/**
 * Compact rounded pointer: white head with a dark seat line over two layered
 * indigo echoes. Round joins come from stroke-linejoin (the standard SVG
 * rounded-polygon trick), keeping the silhouette soft like the reference
 * design. Tip hotspot is at (4, 4) inside the 22px viewbox.
 */
const CURSOR_PATH = "M4.5 3.5 L17 10.9 L11.7 12.6 L9.3 17.8 Z";
/**
 * Per-layer attributes for the cursor's stacked echoes. Built into real SVG
 * nodes (createElementNS) at runtime rather than via innerHTML: pages that
 * enforce Trusted Types (e.g. YouTube's `require-trusted-types-for 'script'`)
 * throw on any `innerHTML = string` assignment, which would abort the whole
 * bootstrap and silently kill the cursor. Programmatic DOM is sink-free.
 */
const CURSOR_LAYERS: Array<Record<string, string>> = [
  {
    fill: "#6d4df2",
    opacity: "0.5",
    stroke: "#6d4df2",
    "stroke-width": "3",
    "stroke-linejoin": "round",
    transform: "translate(2.6,2.6)",
  },
  {
    fill: "#8f6bff",
    opacity: "0.72",
    stroke: "#8f6bff",
    "stroke-width": "3",
    "stroke-linejoin": "round",
    transform: "translate(1.3,1.3)",
  },
  {
    fill: "none",
    stroke: "rgba(44,24,98,0.45)",
    "stroke-width": "4.4",
    "stroke-linejoin": "round",
  },
  { fill: "#ffffff", stroke: "#ffffff", "stroke-width": "2.4", "stroke-linejoin": "round" },
];

/**
 * Bootstrap evaluated once per document in the isolated world. Exposes
 * `__modusAgentOverlay` with promise-returning primitives the main process
 * drives via executeJavaScriptInIsolatedWorld.
 */
const OVERLAY_BOOTSTRAP = `
(() => {
  if (window.__modusAgentOverlay) { return true; }
  const NS = "modus-agent-overlay";
  const TIP_X = 4, TIP_Y = 4;
  const SVGNS = "http://www.w3.org/2000/svg";
  const CURSOR_PATH = ${JSON.stringify(CURSOR_PATH)};
  const CURSOR_LAYERS = ${JSON.stringify(CURSOR_LAYERS)};
  // Build the cursor SVG with real DOM nodes — never innerHTML — so Trusted
  // Types pages (YouTube) can't abort the bootstrap.
  const buildCursorSvg = () => {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("width", "22"); svg.setAttribute("height", "22");
    svg.setAttribute("viewBox", "0 0 22 22");
    svg.setAttribute("role", "presentation"); svg.setAttribute("focusable", "false");
    for (const spec of CURSOR_LAYERS) {
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", CURSOR_PATH);
      for (const key in spec) { path.setAttribute(key, spec[key]); }
      svg.appendChild(path);
    }
    return svg;
  };

  const root = document.createElement("div");
  root.className = NS;
  root.setAttribute("role", "presentation");
  root.setAttribute("aria-hidden", "true");

  const glow = document.createElement("div");
  glow.className = NS + "__glow";
  root.appendChild(glow);

  const makeCursor = (cls) => {
    const node = document.createElement("div");
    node.className = cls;
    node.setAttribute("role", "presentation");
    node.setAttribute("aria-hidden", "true");
    node.appendChild(buildCursorSvg());
    return node;
  };
  const trails = [];
  for (let i = 2; i >= 0; i -= 1) {
    const trail = makeCursor(NS + "__trail");
    trail.dataset.trail = String(i);
    trails.push(trail);
    root.appendChild(trail);
  }
  const cursor = makeCursor(NS + "__cursor");
  root.appendChild(cursor);

  let x = Math.round(innerWidth / 2);
  let y = Math.round(innerHeight / 2);
  const place = (el, px, py) => { el.style.transform = "translate(" + (px - TIP_X) + "px," + (py - TIP_Y) + "px)"; };
  place(cursor, x, y);
  for (const trail of trails) { place(trail, x, y); }

  const attach = () => {
    // Anchor on <html>, not <body>: SPA route changes (e.g. clicking a YouTube
    // video) re-render <body>'s subtree wholesale, which orphans a body-mounted
    // overlay. <html>'s direct children are virtually never recycled, so the
    // overlay rides through client-side navigations untouched.
    const host = document.documentElement || document.body;
    if (host && root.parentNode !== host) { host.appendChild(root); }
  };
  attach();
  // Self-heal: if anything detaches the overlay (full-body swap, framework
  // re-render, node cleanup), re-mount it. subtree:true catches deep removals;
  // the guard keeps it cheap by touching the DOM only when we actually fell out.
  const reattach = () => { if (!root.isConnected) { attach(); } };
  new MutationObserver(reattach).observe(document.documentElement, { childList: true, subtree: true });

  const api = {
    setActive(on) {
      attach();
      root.classList.toggle(NS + "--active", Boolean(on));
      return true;
    },
    setVisible(visible) {
      attach();
      root.style.opacity = visible ? "" : "0";
      return true;
    },
    async moveTo(nx, ny) {
      attach();
      const distance = Math.hypot(nx - x, ny - y);
      if (distance < 1) { return true; }
      // Fitts-flavoured duration: snappy nearby, calm across the viewport.
      const duration = Math.min(520, Math.max(160, 90 + Math.sqrt(distance) * 16));
      const from = "translate(" + (x - TIP_X) + "px," + (y - TIP_Y) + "px)";
      const to = "translate(" + (nx - TIP_X) + "px," + (ny - TIP_Y) + "px)";
      const keyframes = [{ transform: from }, { transform: to }];
      const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
      const move = cursor.animate(keyframes, { duration, easing, fill: "forwards" });
      trails.forEach((trail, index) => {
        trail.animate(keyframes, { duration, delay: 34 * (3 - index), easing, fill: "forwards" });
      });
      try { await move.finished; } catch {}
      x = nx; y = ny;
      return true;
    },
    pulse(kind) {
      attach();
      const squish = kind === "scroll" ? [1, 0.92, 1] : [1, 0.82, 1.04, 1];
      cursor.animate(squish.map((s) => ({ transform: "translate(" + (x - TIP_X) + "px," + (y - TIP_Y) + "px) scale(" + s + ")" })), { duration: 240, easing: "ease-out" });
      const ripple = document.createElement("div");
      ripple.className = NS + "__ripple";
      ripple.setAttribute("role", "presentation");
      ripple.setAttribute("aria-hidden", "true");
      ripple.style.transform = "translate(" + x + "px," + y + "px) scale(0.3)";
      root.appendChild(ripple);
      const grow = ripple.animate(
        [
          { transform: "translate(" + x + "px," + y + "px) scale(0.3)", opacity: 0.9 },
          { transform: "translate(" + x + "px," + y + "px) scale(1.5)", opacity: 0 },
        ],
        { duration: 460, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
      grow.finished.then(() => ripple.remove()).catch(() => ripple.remove());
      return true;
    },
  };
  window.__modusAgentOverlay = api;
  return true;
})();
`;

export class AgentVisualizer extends OverlayInjector {
  private engaged = false;

  constructor(webContents: WebContents) {
    super(webContents, WORLD_ID, "__modusAgentOverlay", OVERLAY_CSS, OVERLAY_BOOTSTRAP);
  }

  /** OverlayInjector hook: replay the glow/cursor after a navigation if engaged. */
  protected reassert(): void {
    if (this.engaged) {
      void this.engage();
    }
  }

  /**
   * Enter "agent is controlling this tab" mode: breathing glow + visible
   * cursor stay on until `release()` — for the whole agent run, not just one
   * tool call. The run lifecycle (pi-sdk-runtime) owns the release.
   */
  async engage(): Promise<void> {
    if (this.gone) {
      return;
    }
    this.engaged = true;
    await this.call(`__modusAgentOverlay.setActive(true)`);
  }

  /** Leave agent-control mode (run finished/cancelled): fade glow + cursor. */
  async release(): Promise<void> {
    if (this.gone || !this.engaged) {
      return;
    }
    this.engaged = false;
    await this.call(`__modusAgentOverlay.setActive(false)`);
  }

  /**
   * Fly the cursor to the action target and play the action cue. Awaited by
   * the tool pipeline so the trusted input fires exactly when the cursor
   * lands — the user sees cause, then effect.
   */
  async actionCue(point: { x: number; y: number }, action: CursorAction): Promise<void> {
    if (this.gone) {
      return;
    }
    await this.engage();
    const x = Math.round(point.x * 100) / 100;
    const y = Math.round(point.y * 100) / 100;
    await this.call(`__modusAgentOverlay.moveTo(${x}, ${y})`);
    if (action === "click" || action === "drag" || action === "input") {
      await this.call(`__modusAgentOverlay.pulse("press")`);
    } else if (action === "scroll") {
      await this.call(`__modusAgentOverlay.pulse("scroll")`);
    }
  }

  /** Follow-up cursor glide without re-pulsing (drag paths). */
  async glideTo(point: { x: number; y: number }): Promise<void> {
    if (this.gone) {
      return;
    }
    await this.call(
      `__modusAgentOverlay.moveTo(${Math.round(point.x * 100) / 100}, ${Math.round(point.y * 100) / 100})`,
    );
  }

  /** Hide the overlay while `capture` runs so screenshots show only the page. */
  async hideDuring<T>(capture: () => Promise<T>): Promise<T> {
    await this.call(`__modusAgentOverlay.setVisible(false)`);
    try {
      return await capture();
    } finally {
      await this.call(`__modusAgentOverlay.setVisible(true)`);
    }
  }

  override dispose(): void {
    this.engaged = false;
    super.dispose();
  }
}
