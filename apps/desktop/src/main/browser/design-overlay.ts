import { DESIGN_ACCENT_COLOR } from "../../shared/contracts";

/**
 * Page-injected Design Mode overlay (runs in an ISOLATED WORLD, distinct from
 * the agent cursor's).
 *
 * CRITICAL — rendered inside a SHADOW ROOT: the overlay nodes live in the page's
 * shared DOM, so the page's own author stylesheets (generic `button{}`,
 * `textarea{}`, `*{}` rules) would otherwise override our `insertCSS` (which is
 * only user-origin, i.e. *below* author origin in the cascade) and wreck the UI
 * — stripped padding, black buttons, stray textarea resize handles. A shadow
 * root is a hard style boundary the page cannot pierce, so our CSS is the only
 * thing that applies. This is the standard technique for injected UI (DevTools,
 * design tools) and the only robust way to look identical on every site.
 *
 * Pure presentation + capture; it never talks to the main process directly (the
 * tab has no preload). It exposes `window.__modusDesignOverlay` whose
 * `takeEvents()` the main process drains by polling while Design Mode is on.
 *
 * Responsibilities: hover highlight + edge-anchored identity chip; click to select +
 * anchored prompt popover; Ctrl+L / send to enqueue a selection; identity via
 * React fiber `_debugSource` (file:line) + owner name, DOM-path fallback;
 * theming via CSS vars set by `setTheme(...)` so it matches Modus light/dark.
 */

/** Isolated world id — must differ from the agent cursor overlay's (1559). */
export const DESIGN_WORLD_ID = 1560;

/** Theme tokens the renderer resolves from Modus's CSS vars and forwards. */
export type DesignThemeTokens = {
  accent: string;
  accentContrast: string;
  surface: string;
  elevated: string;
  fg: string;
  fgSubtle: string;
  fontFamily: string;
  border: string;
  shadow: string;
};

/**
 * Styles live INSIDE the shadow root (injected as a <style> by the bootstrap),
 * so they are immune to the page and need no `insertCSS`. `:host` styles the
 * overlay host element itself; class names are shadow-scoped (short + clean).
 *
 * Highlight fill is derived from --mdo-color: hover 2% (near-invisible),
 * selected 10% (noticeable). Color is the mark's own hex (first = accent,
 * later = random bright). Plain hover uses accent. Controls keep a stronger
 * 16% --mdo-fill.
 */
const SHADOW_CSS = `
:host { all: initial; position: fixed !important; inset: 0 !important; pointer-events: none !important;
  z-index: 2147483646 !important; display: block !important;
  font-family: var(--mdo-font-family);
  --mdo-accent: ${DESIGN_ACCENT_COLOR}; --mdo-accent-contrast: #ffffff;
  --mdo-surface: #1c1c1d; --mdo-elevated: #232325; --mdo-fg: #e4e4e3; --mdo-fg-subtle: #8a8a87;
  --mdo-font-family: "Inter Variable", "Inter", "Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --mdo-border: rgba(255,255,255,0.10); --mdo-shadow: rgba(0,0,0,0.55);
  --mdo-fill: color-mix(in srgb, var(--mdo-accent) 16%, transparent); }
* { box-sizing: border-box; }

.box { position: absolute; left: 0; top: 0; pointer-events: none; border-radius: 0;
  --mdo-color: var(--mdo-accent);
  box-shadow: 0 0 0 1.5px var(--mdo-color);
  background: color-mix(in srgb, var(--mdo-color) 2%, transparent); opacity: 0;
  transition: transform 90ms cubic-bezier(0.22,1,0.36,1), width 90ms cubic-bezier(0.22,1,0.36,1),
    height 90ms cubic-bezier(0.22,1,0.36,1), opacity 100ms, background 100ms; }
.box.is-shown { opacity: 1; }
.box.is-selected { background: color-mix(in srgb, var(--mdo-color) 10%, transparent); }
.multi-box { position: absolute; left: 0; top: 0; pointer-events: none; border-radius: 0;
  box-shadow: 0 0 0 1.5px var(--mdo-color);
  background: color-mix(in srgb, var(--mdo-color) 10%, transparent); }
.draw-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.draw-line { fill: none; stroke: var(--mdo-color, var(--mdo-accent)); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;
  /* Tight ink lift — not the heavy panel --mdo-shadow (too dark/spread on light pages). */
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.18)); }
.draw-box { fill: transparent; stroke: var(--mdo-color, var(--mdo-accent)); stroke-width: 2; stroke-dasharray: 7 5; }

.lens {
  position: absolute; left: 0; top: 0; pointer-events: none; border-radius: 14px; overflow: hidden;
  /* Fallback before the shot lands; shot covers it. */
  background: var(--mdo-elevated);
  /* Glass sheet on any page: dark lift (reads on light) + light hairline (reads on dark). */
  border: none;
  box-shadow:
    0 18px 44px -14px rgba(0, 0, 0, 0.52),
    0 6px 16px -4px rgba(0, 0, 0, 0.32),
    0 1px 3px rgba(0, 0, 0, 0.22),
    0 0 0 0.5px rgba(255, 255, 255, 0.22),
    0 0 0 1px rgba(0, 0, 0, 0.28);
  opacity: 0; transition: opacity 160ms cubic-bezier(0.22,1,0.36,1);
}
.lens.is-shown { opacity: 1; }
.lens-shot { display: block; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
.lens-ink { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 1; }
.lens-ink .draw-line { filter: none; }
/* Rim sits above shot + ink: inset specular / press, top sheen — thin glass edge. */
.lens::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 2;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    inset 0 -1px 0 rgba(0, 0, 0, 0.38),
    inset 1px 0 0 rgba(255, 255, 255, 0.14),
    inset -1px 0 0 rgba(0, 0, 0, 0.18);
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.03) 6%, transparent 18%);
}
/* Capture chrome hide: NEVER opacity on :host (full-viewport opacity:0 flashes
   the WebContentsView white backing). Hide only non-ink chrome via visibility. */
:host([data-capturing]) .box,
:host([data-capturing]) .chip,
:host([data-capturing]) .popover,
:host([data-capturing]) .multi-box,
:host([data-capturing]) .lens { visibility: hidden !important; }
:host([data-capturing="page"]) .draw-layer { visibility: hidden !important; }

.chip { position: absolute; left: 0; top: 0; pointer-events: none; display: inline-flex; align-items: center;
  gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px;
  --mdo-color: var(--mdo-accent); background: var(--mdo-color);
  color: var(--mdo-accent-contrast); font-size: 11px; line-height: 1; font-weight: 500; letter-spacing: 0.01em;
  white-space: nowrap; box-shadow: 0 2px 8px -2px var(--mdo-shadow); opacity: 0;
  transition: opacity 100ms; }
.chip.is-shown { opacity: 1; transition: opacity 100ms, left 90ms cubic-bezier(0.22,1,0.36,1), top 90ms cubic-bezier(0.22,1,0.36,1); }
.chip-tag { opacity: 0.68; font-weight: 500; }

.popover { position: absolute; left: 0; top: 0; pointer-events: auto; width: 416px; max-width: 92vw;
  background: var(--mdo-surface); border: 1px solid var(--mdo-border); border-radius: 16px;
  box-shadow: 0 18px 48px -12px var(--mdo-shadow); padding: 14px; opacity: 0; transform: scale(0.97);
  transform-origin: top left; transition: opacity 120ms, transform 120ms cubic-bezier(0.22,1,0.36,1);
  visibility: hidden; }
.popover.is-open { opacity: 1; transform: none; visibility: visible;
  transition: opacity 120ms, transform 120ms cubic-bezier(0.22,1,0.36,1),
    left 150ms cubic-bezier(0.22,1,0.36,1), top 150ms cubic-bezier(0.22,1,0.36,1); }
.porow { display: flex; align-items: center; gap: 8px; }
.input { flex: 1; min-width: 0; min-height: 30px; max-height: 132px; border: none; outline: none;
  background: transparent; color: var(--mdo-fg); font-family: inherit; font-size: 14px; line-height: 1.45;
  padding: 3px 0; margin: 0; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
.input:empty::before { content: attr(data-placeholder); color: var(--mdo-fg-subtle); pointer-events: none; }
.input::-webkit-scrollbar { display: none; }
.token { display: inline-flex; align-items: center; gap: 3px; max-width: 120px; height: 24px;
  color: var(--mdo-color); font-size: 13px; font-weight: 600; line-height: 1; vertical-align: -0.22em;
  white-space: nowrap; }
.token svg { width: 13px; height: 13px; flex: none; }
.token-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.token-x { display: inline-flex; align-items: center; justify-content: center; width: 0; overflow: hidden; opacity: 0;
  border-radius: 3px; color: var(--mdo-color); transition: width 100ms, opacity 100ms; }
.token-x:hover { background: var(--mdo-fill); }
.token:hover .token-x { width: 12px; opacity: 0.75; }
.send { flex: none; width: 30px; height: 30px; padding: 0; border: none; cursor: pointer; border-radius: 999px;
  background: var(--mdo-fill); color: var(--mdo-accent); display: inline-flex; align-items: center;
  justify-content: center; transition: background 120ms, color 120ms, transform 80ms; }
.send:hover { background: var(--mdo-accent); color: var(--mdo-accent-contrast); }
.send:active { transform: scale(0.93); }
.send svg { width: 16px; height: 16px; }
`;

/** Kept for the OverlayInjector contract; real styles live in the shadow root. */
export const DESIGN_OVERLAY_CSS = "/* modus design mode: styles live in the shadow root */";

/**
 * Icon path data, built into real SVG nodes at runtime (never innerHTML) so
 * Trusted Types pages (YouTube) can't throw on assignment and abort injection.
 */
const INSPECT_PATHS = [
  "M5 3a2 2 0 0 0-2 2",
  "M19 3a2 2 0 0 1 2 2",
  "M5 21a2 2 0 0 1-2-2",
  "M9 3h1",
  "M9 21h2",
  "M14 3h1",
  "M3 9v1",
  "M21 9v2",
  "M3 14v1",
  "m12 12 4 10 1.7-4.3L22 16Z",
];
const ARROW_PATHS = ["M12 19V5", "m5 12 7-7 7 7"];

/**
 * Bootstrap evaluated once per document in the isolated world. Uses string
 * concatenation and NEVER a backtick inside (a stray backtick would terminate
 * this outer TS template literal). All UI is built inside a shadow root.
 */
export const DESIGN_OVERLAY_BOOTSTRAP = `
(() => {
  if (window.__modusDesignOverlay) { return true; }
  var MAX_TEXT = 80;

  var host = document.createElement("div");
  host.setAttribute("role", "presentation");
  host.setAttribute("aria-hidden", "true");
  var shadow = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent = ${JSON.stringify(SHADOW_CSS)};
  shadow.appendChild(style);

  var box = document.createElement("div"); box.className = "box";
  var chip = document.createElement("div"); chip.className = "chip";
  var chipName = document.createElement("span"); chipName.className = "chip-name";
  var chipTag = document.createElement("span"); chipTag.className = "chip-tag";
  chip.appendChild(chipName); chip.appendChild(chipTag);

  var SVGNS = "http://www.w3.org/2000/svg";
  var drawLayer = document.createElementNS(SVGNS, "svg");
  drawLayer.classList.add("draw-layer");
  drawLayer.setAttribute("aria-hidden", "true");
  function makeIcon(paths, sw) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", sw);
    svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", paths[i]); svg.appendChild(p);
    }
    return svg;
  }

  // Built with real DOM nodes (no innerHTML) so Trusted Types can't abort us.
  var popover = document.createElement("div"); popover.className = "popover";
  var porow = document.createElement("div"); porow.className = "porow";
  var popInput = document.createElement("div");
  popInput.className = "input"; popInput.contentEditable = "true";
  popInput.setAttribute("role", "textbox");
  popInput.setAttribute("aria-label", "Describe the change");
  popInput.setAttribute("data-placeholder", "Describe the change or Ctrl+L to add to chat");
  var popSend = document.createElement("button");
  popSend.className = "send"; popSend.setAttribute("type", "button"); popSend.setAttribute("aria-label", "Add to chat");
  popSend.appendChild(makeIcon(${JSON.stringify(ARROW_PATHS)}, "2.4"));
  porow.appendChild(popInput); porow.appendChild(popSend);
  popover.appendChild(porow);

  var lens = document.createElement("div"); lens.className = "lens";
  var lensShot = document.createElement("img"); lensShot.className = "lens-shot"; lensShot.alt = "";
  var lensInk = document.createElementNS(SVGNS, "svg"); lensInk.classList.add("lens-ink");
  lensInk.setAttribute("aria-hidden", "true");
  lens.appendChild(lensShot); lens.appendChild(lensInk);

  shadow.appendChild(drawLayer); shadow.appendChild(lens); shadow.appendChild(box); shadow.appendChild(chip); shadow.appendChild(popover);

  function attach() {
    var h = document.documentElement || document.body;
    if (h && host.parentNode !== h) { h.appendChild(host); }
  }
  attach();
  new MutationObserver(function () { if (!host.isConnected) { attach(); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  var state = { on: false, hovered: null, selected: null };
  var selectedItems = [];
  var multiBoxes = [];
  var drawState = null;
  var pendingAnnotation = null;
  var suppressClick = false;
  var events = [];
  var ACCENT = ${JSON.stringify(DESIGN_ACCENT_COLOR)};
  var usedAccent = false;
  var DRAG_THRESHOLD = 5;
  var LENS_PAD = 24;

  // Mark color authority (mirrors shared/design-mark-color): first = accent, later = random bright.
  function nextMarkColor() {
    if (!usedAccent) { usedAccent = true; return ACCENT; }
    var h = Math.floor(Math.random() * 360);
    var s = 72 + Math.floor(Math.random() * 18);
    var l = 48 + Math.floor(Math.random() * 12);
    return hslToHex(h, s, l);
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    function hex(n) { var v = Math.round((n + m) * 255); return (v < 16 ? "0" : "") + v.toString(16); }
    return "#" + hex(r) + hex(g) + hex(b);
  }
  function paintMark(node, color) {
    if (node && color) { node.style.setProperty("--mdo-color", color); }
  }

  function targetAt(x, y) {
    // The host stays pointer-events:none so document-level capture sees the
    // real page events; hide it defensively while probing the underlying node.
    var prev = host.style.display; host.style.display = "none";
    var el = document.elementFromPoint(x, y);
    host.style.display = prev;
    if (!el || el === host) { return null; }
    if (el === document.documentElement || el === document.body) { return null; }
    return el;
  }

  function cssPath(el) {
    var parts = []; var node = el; var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var sel = node.tagName.toLowerCase();
      if (node.id) { sel += "#" + node.id; parts.unshift(sel); break; }
      var parent = node.parentElement;
      if (parent) {
        var i = 0, idx = 0; var c = parent.firstElementChild;
        while (c) { if (c.tagName === node.tagName) { i += 1; if (c === node) { idx = i; } } c = c.nextElementSibling; }
        if (i > 1) { sel += ":nth-of-type(" + idx + ")"; }
      }
      parts.unshift(sel); node = parent; depth += 1;
    }
    return parts.join(" > ");
  }

  function fiberOf(el) {
    for (var k in el) { if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) { return el[k]; } }
    return null;
  }
  function compName(type) {
    if (!type || typeof type === "string") { return null; }
    return type.displayName || type.name || (type.type && (type.type.displayName || type.type.name)) || null;
  }
  var ATTR_KEEP = { id: 1, class: 1, href: 1, src: 1, alt: 1, title: 1, type: 1, name: 1,
    value: 1, placeholder: 1, role: 1, "for": 1, rel: 1, target: 1 };
  function attrsOf(el) {
    var out = {}; var n = 0; var list = el.attributes;
    if (!list) { return undefined; }
    for (var i = 0; i < list.length && n < 16; i++) {
      var a = list[i]; var name = a.name;
      if (name === "style") { continue; }
      var keep = ATTR_KEEP[name] === 1 || name.indexOf("aria-") === 0 || name.indexOf("data-") === 0;
      if (!keep) { continue; }
      var v = a.value == null ? "" : String(a.value);
      if (v.length > 120) { v = v.slice(0, 119) + "\\u2026"; }
      out[name] = v; n += 1;
    }
    return n > 0 ? out : undefined;
  }
  function ancestorsOf(el) {
    var out = []; var node = el.parentElement; var depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      if (node === document.documentElement || node === document.body) { break; }
      var entry = { tag: node.tagName.toLowerCase() };
      if (node.id) { entry.id = node.id; }
      var cls = (node.getAttribute && node.getAttribute("class")) || "";
      cls = cls.replace(/\\s+/g, " ").trim();
      if (cls) { entry.classes = cls.split(" ").slice(0, 3).join(" "); }
      var role = node.getAttribute && node.getAttribute("role");
      if (role) { entry.role = role; }
      var t = (node.getAttribute && (node.getAttribute("aria-label") || node.getAttribute("title"))) || "";
      if (t) { t = t.replace(/\\s+/g, " ").trim(); if (t.length > 40) { t = t.slice(0, 39) + "\\u2026"; } entry.text = t; }
      out.push(entry); node = node.parentElement; depth += 1;
    }
    return out.length > 0 ? out : undefined;
  }
  var PROP_SKIP = { children: 1, className: 1, style: 1, ref: 1, key: 1, dangerouslySetInnerHTML: 1 };
  function propsOf(el) {
    var fiber = fiberOf(el);
    if (!fiber || !fiber.memoizedProps) { return undefined; }
    var mp = fiber.memoizedProps; var out = {}; var n = 0;
    for (var k in mp) {
      if (!Object.prototype.hasOwnProperty.call(mp, k)) { continue; }
      if (PROP_SKIP[k] === 1 || k.indexOf("on") === 0) { continue; }
      var v = mp[k]; var tv = typeof v;
      if (tv !== "string" && tv !== "number" && tv !== "boolean") { continue; }
      var s = String(v); if (s.length > 120) { s = s.slice(0, 119) + "\\u2026"; }
      out[k] = s; n += 1; if (n >= 12) { break; }
    }
    return n > 0 ? out : undefined;
  }
  function identify(el) {
    var tag = el.tagName.toLowerCase();
    var componentName = null, source = null;
    var fiber = fiberOf(el); var hops = 0;
    while (fiber && hops < 30) {
      if (!source && fiber._debugSource && fiber._debugSource.fileName) {
        source = { file: String(fiber._debugSource.fileName), line: fiber._debugSource.lineNumber || 0,
          column: fiber._debugSource.columnNumber || undefined };
      }
      if (!componentName) { var n = compName(fiber.type) || (fiber._debugOwner && compName(fiber._debugOwner.type)); if (n) { componentName = n; } }
      if (source && componentName) { break; }
      fiber = fiber.return; hops += 1;
    }
    var text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT - 1) + "\\u2026"; }
    var cs = window.getComputedStyle(el);
    var styleSummary = { color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight, padding: cs.padding, margin: cs.margin, display: cs.display,
      position: cs.position, width: cs.width, height: cs.height,
      border: cs.border, borderRadius: cs.borderRadius, background: cs.backgroundColor };
    if (cs.display === "flex" || cs.display === "inline-flex") {
      styleSummary.flexDirection = cs.flexDirection; styleSummary.justifyContent = cs.justifyContent;
      styleSummary.alignItems = cs.alignItems; styleSummary.gap = cs.gap;
    } else if (cs.display === "grid" || cs.display === "inline-grid") {
      styleSummary.gridTemplateColumns = cs.gridTemplateColumns; styleSummary.gap = cs.gap;
    }
    var label = componentName ? componentName + " \\u00b7 " + tag : tag;
    return { tagName: tag, componentName: componentName || undefined, source: source || undefined,
      domPath: cssPath(el), text: text || undefined, styleSummary: styleSummary, label: label,
      attributes: attrsOf(el), ancestors: ancestorsOf(el), props: propsOf(el) };
  }

  function payloadOf(el) {
    var r = el.getBoundingClientRect();
    var id = identify(el);
    id.rect = { x: r.left, y: r.top, width: r.width, height: r.height };
    return id;
  }

  function rectFromPoints(points, pad) {
    if (pad == null) { pad = 0; }
    var minX = points[0].x, minY = points[0].y, maxX = points[0].x, maxY = points[0].y;
    for (var i = 1; i < points.length; i++) {
      var p = points[i];
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(window.innerWidth, maxX + pad); maxY = Math.min(window.innerHeight, maxY + pad);
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  function inflateRect(r, pad) {
    return rectFromPoints([
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
    ], pad);
  }

  function setSvgRect(el, r) {
    el.setAttribute("x", String(r.x)); el.setAttribute("y", String(r.y));
    el.setAttribute("width", String(Math.max(1, r.width)));
    el.setAttribute("height", String(Math.max(1, r.height)));
  }

  function pathFromPoints(points) {
    if (!points || points.length === 0) { return ""; }
    var d = "M " + points[0].x + " " + points[0].y;
    for (var i = 1; i < points.length; i++) { d += " L " + points[i].x + " " + points[i].y; }
    return d;
  }

  function clearLens() {
    lens.classList.remove("is-shown");
    lensShot.removeAttribute("src");
    lensInk.replaceChildren();
  }

  function clearAnnotation() {
    drawLayer.replaceChildren();
    clearLens();
    drawState = null;
    pendingAnnotation = null;
  }

  function showLens(payload) {
    if (!payload || !pendingAnnotation) { return false; }
    var lr = payload.lensRect || pendingAnnotation.lensRect;
    var ink = payload.inkRect || pendingAnnotation.inkRect;
    if (!lr || !ink) { return false; }
    if (payload.dataUrl) {
      pendingAnnotation.screenshotDataUrl = payload.dataUrl;
      lensShot.src = payload.dataUrl;
    }
    lens.style.transform = "translate(" + lr.x + "px," + lr.y + "px)";
    lens.style.width = Math.max(1, lr.width) + "px";
    lens.style.height = Math.max(1, lr.height) + "px";
    lensInk.setAttribute("viewBox", "0 0 " + lr.width + " " + lr.height);
    lensInk.replaceChildren();
    // Bitmap from ink-mode capture already includes the mark. Local SVG is only
    // a fallback when capture failed (no dataUrl).
    if (!payload.dataUrl) {
      var markColor = pendingAnnotation.color || ACCENT;
      if (pendingAnnotation.kind === "box") {
        var rect = document.createElementNS(SVGNS, "rect");
        rect.classList.add("draw-box");
        paintMark(rect, markColor);
        setSvgRect(rect, {
          x: ink.x - lr.x, y: ink.y - lr.y,
          width: ink.width, height: ink.height,
        });
        lensInk.appendChild(rect);
      } else if (pendingAnnotation.points && pendingAnnotation.points.length > 0) {
        var local = [];
        for (var i = 0; i < pendingAnnotation.points.length; i++) {
          local.push({
            x: pendingAnnotation.points[i].x - lr.x,
            y: pendingAnnotation.points[i].y - lr.y,
          });
        }
        var path = document.createElementNS(SVGNS, "path");
        path.classList.add("draw-line");
        paintMark(path, markColor);
        path.setAttribute("d", pathFromPoints(local));
        lensInk.appendChild(path);
      }
    }
    // One paint: drop live ink + end capture mode + show lens (no ink flash).
    drawLayer.replaceChildren();
    host.removeAttribute("data-capturing");
    lens.classList.add("is-shown");
    openPopover({
      left: lr.x, top: lr.y,
      right: lr.x + lr.width, bottom: lr.y + lr.height,
    }, { label: pendingAnnotation.kind });
    return true;
  }

  function unionRect(items) {
    var first = items[0].payload.rect;
    var left = first.x, top = first.y, right = first.x + first.width, bottom = first.y + first.height;
    for (var i = 1; i < items.length; i++) {
      var r = items[i].payload.rect;
      left = Math.min(left, r.x); top = Math.min(top, r.y);
      right = Math.max(right, r.x + r.width); bottom = Math.max(bottom, r.y + r.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function indexOfSelected(el) {
    for (var i = 0; i < selectedItems.length; i++) {
      if (selectedItems[i].el === el) { return i; }
    }
    return -1;
  }
  // One paint path: color from the mark's own hex (or accent for plain hover).
  function paintHighlight(node, color, selected) {
    node.style.setProperty("--mdo-color", color || ACCENT);
    node.classList.toggle("is-selected", !!selected);
  }
  function placeBox(r, color, selected) {
    box.style.transform = "translate(" + r.left + "px," + r.top + "px)";
    box.style.width = Math.max(0, r.width) + "px"; box.style.height = Math.max(0, r.height) + "px";
    paintHighlight(box, color, selected);
    box.classList.add("is-shown");
  }
  function placeChip(r, id, color) {
    chipName.textContent = id.componentName || id.tagName;
    chipTag.textContent = id.componentName ? ("\\u00b7 " + id.tagName) : "";
    chip.style.setProperty("--mdo-color", color || ACCENT);
    // Measure after text update (opacity:0 still lays out); then anchor.
    var cw = Math.max(chip.offsetWidth, 1); var ch = chip.offsetHeight || 20;
    // Right-flush when the chip fits the box; otherwise center on the bottom edge.
    var left = cw <= r.width ? (r.right - cw) : (r.left + r.width / 2 - cw / 2);
    left = Math.min(window.innerWidth - cw, Math.max(0, left));
    // Ride the bottom edge; flip to the top edge if the viewport would clip it.
    var top = r.bottom - ch / 2;
    if (top + ch > window.innerHeight) { top = r.top - ch / 2; }
    top = Math.min(window.innerHeight - ch, Math.max(0, top));
    chip.style.left = left + "px"; chip.style.top = top + "px";
    chip.classList.add("is-shown");
  }
  // Class-driven visibility (never inline opacity): a stale inline opacity:0
  // would outrank the class rule and keep the box hidden on the next enable.
  function clearHover() {
    box.classList.remove("is-shown"); box.classList.remove("is-selected");
    chip.classList.remove("is-shown");
  }

  function clearHoverPreview() {
    if (pendingAnnotation || selectedItems.length > 0 || !state.selected || state.hovered !== state.selected) {
      clearHover();
    }
    state.hovered = state.selected || null;
  }

  function clearMulti() {
    for (var i = 0; i < multiBoxes.length; i++) { multiBoxes[i].remove(); }
    multiBoxes = []; selectedItems = [];
  }

  function tokenFor(index, item) {
    item = item || (selectedItems[index] && selectedItems[index].payload);
    if (!item) { return null; }
    var token = document.createElement("span");
    token.className = "token";
    token.contentEditable = "false";
    token.setAttribute("data-token-index", String(index));
    token.setAttribute("data-path", item.domPath || "");
    token.style.setProperty("--mdo-color", item.color || ACCENT);
    token.appendChild(makeIcon(${JSON.stringify(INSPECT_PATHS)}, "2"));
    var label = document.createElement("span");
    label.className = "token-label";
    label.textContent = item.componentName || item.tagName;
    token.appendChild(label);
    var x = document.createElement("span");
    x.className = "token-x";
    x.setAttribute("data-token-remove", "true");
    x.textContent = "×";
    token.appendChild(x);
    return token;
  }

  // Selection model is authoritative for WHICH elements are selected (and their
  // mark color). The contenteditable's own child order is authoritative for
  // WHERE tokens sit relative to the user's typed prompt. Sync must never
  // restack "all tokens then text" — that prepends new tokens in front of the
  // prompt and is exactly the order bug users see.
  function selectionItems() {
    if (pendingAnnotation) { return []; }
    return selectedItems;
  }
  function tokenPath(item) {
    return (item && item.payload && item.payload.domPath) || "";
  }
  function appendTokenNode(index, item) {
    var token = tokenFor(index, item.payload);
    if (!token) { return null; }
    // Always append at the end of the contenteditable so a newly selected
    // element lands after any already-typed prompt — never restacked in front.
    popInput.appendChild(token);
    popInput.appendChild(document.createTextNode("\\u00a0"));
    return token;
  }
  function seedInput() {
    popInput.replaceChildren();
    if (pendingAnnotation) { placeCaretAtEnd(); return; }
    var items = selectionItems();
    for (var i = 0; i < items.length; i++) { appendTokenNode(i, items[i]); }
    placeCaretAtEnd();
  }
  function syncTokensPreservePrompt() {
    if (pendingAnnotation) { return; }
    var items = selectionItems();
    var tokens = Array.prototype.slice.call(popInput.querySelectorAll(".token"));
    var byPath = {};
    for (var t = 0; t < tokens.length; t++) {
      byPath[tokens[t].getAttribute("data-path") || ("#" + t)] = tokens[t];
    }
    var keep = {};
    for (var i = 0; i < items.length; i++) {
      var path = tokenPath(items[i]) || ("#" + i);
      var existing = byPath[path];
      if (!existing) {
        // New selection → append after existing content (including typed prompt).
        appendTokenNode(i, items[i]);
      } else {
        existing.setAttribute("data-token-index", String(i));
        existing.style.setProperty("--mdo-color", items[i].payload.color || ACCENT);
        var label = existing.querySelector(".token-label");
        if (label) {
          label.textContent = items[i].payload.componentName || items[i].payload.tagName;
        }
      }
      keep[path] = true;
    }
    for (var r = 0; r < tokens.length; r++) {
      var oldPath = tokens[r].getAttribute("data-path") || ("#" + r);
      if (keep[oldPath]) { continue; }
      var next = tokens[r].nextSibling;
      tokens[r].remove();
      if (next && next.nodeType === Node.TEXT_NODE && next.textContent === "\\u00a0") { next.remove(); }
    }
    placeCaretAtEnd();
  }

  function placeCaretAtEnd() {
    var range = document.createRange();
    range.selectNodeContents(popInput);
    range.collapse(false);
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }

  function drawMulti() {
    for (var i = 0; i < multiBoxes.length; i++) { multiBoxes[i].remove(); }
    multiBoxes = [];
    for (var j = 0; j < selectedItems.length; j++) {
      var item = selectedItems[j];
      // Color is assigned at select time (selectAt / toggleMulti); paint only.
      var r = item.payload.rect;
      var marker = document.createElement("div");
      marker.className = "multi-box";
      marker.style.setProperty("--mdo-color", item.payload.color || ACCENT);
      marker.style.transform = "translate(" + r.x + "px," + r.y + "px)";
      marker.style.width = Math.max(0, r.width) + "px";
      marker.style.height = Math.max(0, r.height) + "px";
      shadow.insertBefore(marker, popover);
      multiBoxes.push(marker);
    }
  }

  function toggleMulti(el) {
    for (var i = 0; i < selectedItems.length; i++) {
      if (selectedItems[i].el === el) {
        selectedItems.splice(i, 1);
        drawMulti();
        return;
      }
    }
    var payload = payloadOf(el);
    payload.color = nextMarkColor();
    selectedItems.push({ el: el, payload: payload });
    drawMulti();
  }

  function openPopover(r, id) {
    var width = 416, height = 74;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    var top = r.bottom + 10;
    if (top + height > window.innerHeight) { top = Math.max(8, r.top - height - 10); }
    popover.style.left = left + "px"; popover.style.top = top + "px";
    var wasOpen = popover.classList.contains("is-open");
    popover.classList.add("is-open");
    // Fresh open → seed tokens. Already open → selection changed; keep the prompt.
    if (wasOpen) { syncTokensPreservePrompt(); }
    else { seedInput(); }
    setTimeout(function () { try { popInput.focus(); } catch (e) {} }, 30);
  }
  function closePopover() { popover.classList.remove("is-open"); }

  // Cancel the current selection entirely (Esc / after hand-off): close the
  // popover, drop the selected state, and return focus to the page so
  // hover/selection can resume immediately.
  function deselect() {
    closePopover();
    state.selected = null;
    clearMulti();
    clearAnnotation();
    try { popInput.blur(); } catch (e) {}
  }
  function handOffSelection() {
    closePopover();
    clearLens();
    try { popInput.blur(); } catch (e) {}
  }

  // True when the pointer sits over the open popover card (its own input/button
  // own those events; we must not re-target or intercept there).
  function overUi(e) {
    if (!popover.classList.contains("is-open")) { return false; }
    var r = popover.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function inputParts() {
    var parts = [];
    var pushText = function (text) {
      var normalized = String(text || "").replace(/\\u00a0/g, " ");
      if (!normalized) { return; }
      var last = parts[parts.length - 1];
      if (last && last.type === "text") { last.text += normalized; }
      else { parts.push({ type: "text", text: normalized }); }
    };
    var walk = function (node) {
      var children = Array.prototype.slice.call(node.childNodes || []);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === Node.TEXT_NODE) { pushText(child.textContent || ""); }
        else if (child.nodeType === Node.ELEMENT_NODE) {
          var el = child;
          var index = el.getAttribute("data-token-index");
          if (index !== null) { parts.push({ type: "element", index: Number(index) }); }
          else if (el.tagName === "BR") { pushText("\\n"); }
          else { walk(el); }
        }
      }
    };
    walk(popInput);
    return parts;
  }

  function plainInputText(parts) {
    return parts.filter(function (part) { return part.type === "text"; })
      .map(function (part) { return part.text; }).join("").trim();
  }

  function emit(kind, el, contentParts) {
    if (!el || !el.isConnected) { return; }
    prepareCapture();
    var p = payloadOf(el); p.kind = kind;
    var selected = selectedItems[0];
    p.color = (selected && selected.el === el && selected.payload.color) || ACCENT;
    var text = plainInputText(contentParts || []);
    if (text) { p.seedText = text; }
    if (contentParts && contentParts.length > 0) { p.contentParts = contentParts; }
    events.push(p);
  }

  function emitMulti(kind, contentParts) {
    var indices = (contentParts || []).filter(function (part) { return part.type === "element"; })
      .map(function (part) { return part.index; });
    if (indices.length === 0) { return; }
    var live = [];
    for (var i = 0; i < indices.length; i++) {
      var item = selectedItems[indices[i]];
      if (item && item.el.isConnected) {
        var payload = payloadOf(item.el);
        payload.color = item.payload.color || nextMarkColor();
        live.push({ el: item.el, payload: payload });
      }
    }
    if (live.length === 0) { return; }
    selectedItems = live;
    prepareCapture();
    var p = {
      kind: kind,
      label: live.length + " selected elements",
      tagName: "selection",
      domPath: live.map(function (item) { return item.payload.domPath; }).join(" + "),
      text: live.map(function (item) { return item.payload.text; }).filter(Boolean).join(" | ") || undefined,
      rect: unionRect(live),
      elements: live.map(function (item) { return item.payload; }),
    };
    var text = plainInputText(contentParts || []);
    if (text) { p.seedText = text; }
    if (contentParts && contentParts.length > 0) { p.contentParts = contentParts; }
    events.push(p);
  }

  function emitAnnotation(kind, contentParts) {
    if (!pendingAnnotation) { return; }
    prepareCapture();
    var text = plainInputText(contentParts || []);
    var p = {
      type: "annotation",
      kind: kind,
      annotationKind: pendingAnnotation.kind,
      label: pendingAnnotation.kind === "box" ? "Selected region" : "Drawn annotation",
      rect: pendingAnnotation.lensRect || pendingAnnotation.rect,
      color: pendingAnnotation.color || ACCENT,
    };
    if (pendingAnnotation.points && pendingAnnotation.points.length > 0) { p.points = pendingAnnotation.points; }
    if (pendingAnnotation.screenshotDataUrl) { p.screenshotDataUrl = pendingAnnotation.screenshotDataUrl; }
    if (text) { p.seedText = text; }
    events.push(p);
  }

  function prepareCapture() {
    clearHover();
    if (!pendingAnnotation && selectedItems.length > 0) { drawMulti(); }
  }

  function requestLensPreview() {
    if (!pendingAnnotation || !pendingAnnotation.lensRect) { return; }
    events.push({
      type: "annotation-preview",
      annotationKind: pendingAnnotation.kind,
      rect: pendingAnnotation.lensRect,
      inkRect: pendingAnnotation.inkRect,
      points: pendingAnnotation.points,
    });
  }

  function startDraw(e) {
    if (!state.on || overUi(e) || e.button !== 0) { return; }
    e.preventDefault(); e.stopPropagation();
    drawState = {
      started: false,
      kind: e.shiftKey ? "box" : "freehand",
      start: { x: e.clientX, y: e.clientY },
      points: [{ x: e.clientX, y: e.clientY }],
      node: null,
    };
  }

  function updateDraw(e) {
    if (!drawState) { return; }
    var dx = e.clientX - drawState.start.x;
    var dy = e.clientY - drawState.start.y;
    if (!drawState.started && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) { return; }
    e.preventDefault(); e.stopPropagation();
    if (!drawState.started) {
      drawState.started = true;
      // Clear prior selection/annotation UI, but NEVER clearAnnotation() here —
      // that nulls drawState and aborts the gesture mid-flight.
      closePopover(); clearHover(); clearMulti(); clearLens();
      pendingAnnotation = null; state.selected = null;
      drawLayer.replaceChildren();
      var markColor = nextMarkColor();
      drawState.color = markColor;
      if (drawState.kind === "box") {
        drawState.node = document.createElementNS(SVGNS, "rect");
        drawState.node.classList.add("draw-box");
        setSvgRect(drawState.node, { x: drawState.start.x, y: drawState.start.y, width: 1, height: 1 });
      } else {
        drawState.node = document.createElementNS(SVGNS, "path");
        drawState.node.classList.add("draw-line");
      }
      paintMark(drawState.node, markColor);
      drawLayer.appendChild(drawState.node);
    }
    if (drawState.kind === "box") {
      var r = rectFromPoints([drawState.start, { x: e.clientX, y: e.clientY }], 0);
      setSvgRect(drawState.node, r);
    } else {
      drawState.points.push({ x: e.clientX, y: e.clientY });
      drawState.node.setAttribute("d", pathFromPoints(drawState.points));
    }
  }

  function finishDraw(e) {
    if (!drawState) { return; }
    if (!drawState.started) {
      drawState = null;
      e.preventDefault(); e.stopPropagation();
      suppressClick = true;
      window.setTimeout(function () { suppressClick = false; }, 0);
      selectAt(e);
      return;
    }
    e.preventDefault(); e.stopPropagation();
    suppressClick = true;
    window.setTimeout(function () { suppressClick = false; }, 0);
    if (drawState.kind === "freehand") {
      drawState.points.push({ x: e.clientX, y: e.clientY });
      drawState.node.setAttribute("d", pathFromPoints(drawState.points));
    }
    var points = drawState.kind === "box"
      ? [drawState.start, { x: e.clientX, y: e.clientY }]
      : drawState.points;
    // Ink = exact gesture (pad 0). Lens = ink + pad for the glass card / capture.
    var inkRect = rectFromPoints(points, 0);
    var lensRect = inflateRect(inkRect, LENS_PAD);
    if (drawState.kind === "box") { setSvgRect(drawState.node, inkRect); }
    pendingAnnotation = {
      kind: drawState.kind,
      inkRect: inkRect,
      lensRect: lensRect,
      rect: lensRect,
      color: drawState.color || ACCENT,
      points: drawState.kind === "freehand" ? drawState.points.slice() : undefined,
    };
    drawState = null;
    // Keep live ink until ink-mode capture; showLens ends capturing in one paint.
    requestLensPreview();
  }

  function selectAt(e) {
    var el = targetAt(e.clientX, e.clientY);
    if (!el) { return; }
    if (e.shiftKey) {
      // Append-only: array order IS selection order. Never prepend.
      toggleMulti(el);
      state.selected = selectedItems[0] ? selectedItems[0].el : null;
      state.hovered = el;
      if (selectedItems.length > 0) {
        var groupRect = unionRect(selectedItems);
        clearHover();
        openPopover({ left: groupRect.x, top: groupRect.y, right: groupRect.x + groupRect.width, bottom: groupRect.y + groupRect.height }, { label: selectedItems.length + " elements" });
      } else { closePopover(); }
      return;
    }
    // Single select replaces the set with exactly this element (first color = accent).
    clearMulti();
    var payload = payloadOf(el);
    payload.color = nextMarkColor();
    selectedItems.push({ el: el, payload: payload });
    state.selected = el; state.hovered = el;
    drawMulti();
    var r = el.getBoundingClientRect();
    clearHover();
    openPopover(r, identify(el));
  }

  function onMove(e) {
    if (!state.on) { return; }
    if (drawState) { updateDraw(e); return; }
    if (overUi(e)) { clearHoverPreview(); return; }
    e.preventDefault(); e.stopPropagation();
    var el = targetAt(e.clientX, e.clientY);
    if (!el || el === state.hovered) { return; }
    state.hovered = el;
    // Selected elements already have a colored multi-box — don't overlay accent hover.
    if (indexOfSelected(el) >= 0) { clearHover(); return; }
    var r = el.getBoundingClientRect(); var id = identify(el);
    placeBox(r, ACCENT, false); placeChip(r, id, ACCENT);
  }
  function onClick(e) {
    if (!state.on) { return; }
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    // Clicks inside the popover belong to its input/button — leave them be.
    if (overUi(e)) { return; }
    e.preventDefault(); e.stopPropagation();
    selectAt(e);
  }
  function onKey(e) {
    if (!state.on) { return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
      var el = state.selected || state.hovered;
      if (pendingAnnotation || selectedItems.length > 0 || el) {
        e.preventDefault(); e.stopPropagation();
        var parts = inputParts();
        if (pendingAnnotation) { emitAnnotation("add", parts); }
        else if (selectedItems.length > 0) { emitMulti("add", parts); }
        else { emit("add", el, parts); }
        handOffSelection();
      }
    } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); deselect(); }
  }
  function submitPopover() {
    var parts = inputParts();
    if (pendingAnnotation) { emitAnnotation("submit", parts); handOffSelection(); }
    else if (selectedItems.length > 0) { emitMulti("submit", parts); handOffSelection(); }
    else if (state.selected) { emit("submit", state.selected, parts); handOffSelection(); }
  }
  popSend.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); submitPopover(); });
  popInput.addEventListener("focusin", clearHoverPreview);
  popInput.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPopover(); }
    else if (e.key === "Escape") { e.preventDefault(); deselect(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      var parts = inputParts();
      if (pendingAnnotation) { emitAnnotation("add", parts); handOffSelection(); }
      else if (selectedItems.length > 0) { emitMulti("add", parts); handOffSelection(); }
      else if (state.selected) { emit("add", state.selected, parts); handOffSelection(); }
    }
  });
  popInput.addEventListener("mousedown", function (e) {
    var target = e.target && e.target.nodeType === Node.ELEMENT_NODE ? e.target : null;
    var remove = target && target.closest("[data-token-remove]");
    var token = remove && remove.closest("[data-token-index]");
    if (token) {
      e.preventDefault();
      var idx = Number(token.getAttribute("data-token-index"));
      if (!isNaN(idx) && idx >= 0 && idx < selectedItems.length) {
        selectedItems.splice(idx, 1);
        drawMulti();
        state.selected = selectedItems[0] ? selectedItems[0].el : null;
      }
      if (selectedItems.length === 0 && !pendingAnnotation) { deselect(); }
      else { syncTokensPreservePrompt(); }
    }
  });

  // ── Scroll lock ────────────────────────────────────────────────────────
  // While Design Mode is on the page must not scroll (so highlight geometry,
  // which is viewport-relative, stays valid and selection is deliberate).
  // overflow:hidden stops the scrollbar + keyboard scroll of the document;
  // capturing wheel/touchmove also stops nested scroll containers. Scrolling
  // INSIDE our own popover (a long prompt) is still allowed via composedPath.
  var savedOverflow = null;
  function overUiPath(e) {
    return typeof e.composedPath === "function" && e.composedPath().indexOf(popover) >= 0;
  }
  function onWheel(e) { if (!overUiPath(e)) { e.preventDefault(); } }
  function onTouchMove(e) { if (!overUiPath(e)) { e.preventDefault(); } }
  function blockPageGesture(e) {
    if (state.on && !overUiPath(e)) { e.preventDefault(); e.stopPropagation(); }
  }
  function lockScroll() {
    if (savedOverflow) { return; }
    var de = document.documentElement, b = document.body;
    savedOverflow = { de: de ? de.style.overflow : "", b: b ? b.style.overflow : "" };
    if (de) { de.style.overflow = "hidden"; }
    if (b) { b.style.overflow = "hidden"; }
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    document.addEventListener("selectstart", blockPageGesture, true);
    document.addEventListener("dragstart", blockPageGesture, true);
  }
  function unlockScroll() {
    if (savedOverflow) {
      var de = document.documentElement, b = document.body;
      if (de) { de.style.overflow = savedOverflow.de; }
      if (b) { b.style.overflow = savedOverflow.b; }
      savedOverflow = null;
    }
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("touchmove", onTouchMove, true);
    document.removeEventListener("selectstart", blockPageGesture, true);
    document.removeEventListener("dragstart", blockPageGesture, true);
  }

  function bind() {
    document.addEventListener("mousedown", startDraw, true);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", finishDraw, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }
  function unbind() {
    document.removeEventListener("mousedown", startDraw, true);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", finishDraw, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  }

  window.__modusDesignOverlay = {
    setEnabled: function (on) {
      attach(); state.on = !!on;
      if (state.on) { bind(); lockScroll(); }
      else {
        unbind(); unlockScroll(); clearHover(); closePopover(); clearMulti(); clearAnnotation();
        state.hovered = null; state.selected = null;
        usedAccent = false;
      }
      return true;
    },
    setTheme: function (t) {
      if (!t) { return true; }
      var s = host.style;
      if (t.accent) s.setProperty("--mdo-accent", t.accent);
      if (t.accentContrast) s.setProperty("--mdo-accent-contrast", t.accentContrast);
      if (t.surface) s.setProperty("--mdo-surface", t.surface);
      if (t.elevated) s.setProperty("--mdo-elevated", t.elevated);
      if (t.fg) s.setProperty("--mdo-fg", t.fg);
      if (t.fgSubtle) s.setProperty("--mdo-fg-subtle", t.fgSubtle);
      if (t.fontFamily) s.setProperty("--mdo-font-family", t.fontFamily);
      if (t.border) s.setProperty("--mdo-border", t.border);
      if (t.shadow) s.setProperty("--mdo-shadow", t.shadow);
      return true;
    },
    takeEvents: function () { var out = events.slice(); events.length = 0; return JSON.stringify(out); },
    clearSelection: function () { deselect(); return true; },
    showLens: function (payload) { return showLens(payload || {}); },
    /**
     * Capture mode — authority for what the view capture may see:
     *   "off"  — normal UI
     *   "page" — hide all chrome (element thumbnails: clean page only)
     *   "ink"  — hide chrome but keep draw-layer strokes (annotation: page + mark)
     * Returns a promise that resolves after the next paint so capture doesn't race.
     */
    setCaptureMode: function (mode) {
      attach();
      if (mode === "page" || mode === "ink") { host.setAttribute("data-capturing", mode); }
      else { host.removeAttribute("data-capturing"); }
      return new Promise(function (resolve) {
        requestAnimationFrame(function () { resolve(true); });
      });
    },
    isEnabled: function () { return state.on; },
  };
  return true;
})();
`;
