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
 * Responsibilities: hover highlight + centered identity chip; click to select +
 * anchored prompt popover; Ctrl+L / send to enqueue a selection; identity via
 * React fiber `_debugSource` (file:line) + owner name, DOM-path fallback;
 * theming via CSS vars set by `setTheme(...)` so it matches Modus light/dark.
 */

/** Isolated world id — must differ from the agent cursor overlay's (1559). */
export const DESIGN_WORLD_ID = 1560;

/** Theme tokens the renderer resolves from Modus's CSS vars and forwards. */
export type DesignThemeTokens = {
  accent: string;
  accentSoft: string;
  accentContrast: string;
  surface: string;
  elevated: string;
  fg: string;
  fgSubtle: string;
  border: string;
  shadow: string;
  fill: string;
};

/**
 * Styles live INSIDE the shadow root (injected as a <style> by the bootstrap),
 * so they are immune to the page and need no `insertCSS`. `:host` styles the
 * overlay host element itself; class names are shadow-scoped (short + clean).
 */
const SHADOW_CSS = `
:host { all: initial; position: fixed !important; inset: 0 !important; pointer-events: none !important;
  z-index: 2147483646 !important; display: block !important;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mdo-accent: #853ff4; --mdo-accent-soft: #b388ff; --mdo-accent-contrast: #ffffff;
  --mdo-surface: #1c1c1d; --mdo-elevated: #232325; --mdo-fg: #e4e4e3; --mdo-fg-subtle: #8a8a87;
  --mdo-border: rgba(255,255,255,0.10); --mdo-shadow: rgba(0,0,0,0.55); --mdo-fill: rgba(133,63,244,0.14); }
* { box-sizing: border-box; }

.box { position: absolute; left: 0; top: 0; pointer-events: none; border-radius: 5px;
  box-shadow: 0 0 0 1.5px var(--mdo-accent); background: var(--mdo-fill); opacity: 0;
  transition: transform 90ms cubic-bezier(0.22,1,0.36,1), width 90ms cubic-bezier(0.22,1,0.36,1),
    height 90ms cubic-bezier(0.22,1,0.36,1), opacity 100ms; }
.box.is-shown { opacity: 1; }
.box.is-selected { box-shadow: 0 0 0 2px var(--mdo-accent); }

.chip { position: absolute; left: 0; top: 0; pointer-events: none; display: inline-flex; align-items: center;
  gap: 6px; height: 23px; padding: 0 10px; border-radius: 6px; background: var(--mdo-accent);
  color: var(--mdo-accent-contrast); font-size: 12px; line-height: 1; font-weight: 600; letter-spacing: 0.01em;
  white-space: nowrap; box-shadow: 0 4px 14px -4px var(--mdo-shadow); opacity: 0; transform: translateX(-50%);
  transition: opacity 100ms; }
.chip.is-shown { opacity: 1; transition: opacity 100ms, left 90ms cubic-bezier(0.22,1,0.36,1), top 90ms cubic-bezier(0.22,1,0.36,1); }
.chip-tag { opacity: 0.68; font-weight: 500; }

.popover { position: absolute; left: 0; top: 0; pointer-events: auto; width: 332px; max-width: 92vw;
  background: var(--mdo-surface); border: 1px solid var(--mdo-border); border-radius: 16px;
  box-shadow: 0 18px 48px -12px var(--mdo-shadow); padding: 14px; opacity: 0; transform: scale(0.97);
  transform-origin: top left; transition: opacity 120ms, transform 120ms cubic-bezier(0.22,1,0.36,1);
  visibility: hidden; }
.popover.is-open { opacity: 1; transform: none; visibility: visible;
  transition: opacity 120ms, transform 120ms cubic-bezier(0.22,1,0.36,1),
    left 150ms cubic-bezier(0.22,1,0.36,1), top 150ms cubic-bezier(0.22,1,0.36,1); }
.pophead { display: flex; align-items: center; gap: 6px; max-width: 100%; margin: 0 0 10px;
  color: var(--mdo-accent); font-size: 13px; font-weight: 600; white-space: nowrap; }
.pophead svg { width: 15px; height: 15px; flex: none; }
.pophead-label { overflow: hidden; text-overflow: ellipsis; }
.porow { display: flex; align-items: center; gap: 8px; }
.input { flex: 1; min-width: 0; min-height: 24px; max-height: 132px; resize: none; border: none; outline: none;
  background: transparent; color: var(--mdo-fg); font-family: inherit; font-size: 14px; line-height: 1.45;
  padding: 2px 0; margin: 0; }
.input::placeholder { color: var(--mdo-fg-subtle); }
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
  var pophead = document.createElement("div"); pophead.className = "pophead";
  pophead.appendChild(makeIcon(${JSON.stringify(INSPECT_PATHS)}, "2"));
  var popLabel = document.createElement("span"); popLabel.className = "pophead-label";
  pophead.appendChild(popLabel);
  var porow = document.createElement("div"); porow.className = "porow";
  var popInput = document.createElement("textarea");
  popInput.className = "input"; popInput.setAttribute("rows", "1");
  popInput.setAttribute("placeholder", "Describe the change or Ctrl+L to add to chat");
  var popSend = document.createElement("button");
  popSend.className = "send"; popSend.setAttribute("type", "button"); popSend.setAttribute("aria-label", "Add to chat");
  popSend.appendChild(makeIcon(${JSON.stringify(ARROW_PATHS)}, "2.4"));
  porow.appendChild(popInput); porow.appendChild(popSend);
  popover.appendChild(pophead); popover.appendChild(porow);

  shadow.appendChild(box); shadow.appendChild(chip); shadow.appendChild(popover);

  function attach() {
    var h = document.documentElement || document.body;
    if (h && host.parentNode !== h) { h.appendChild(host); }
  }
  attach();
  new MutationObserver(function () { if (!host.isConnected) { attach(); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  var state = { on: false, hovered: null, selected: null };
  var events = [];

  function targetAt(x, y) {
    // Our host is pointer-events:none so elementFromPoint already skips it; the
    // explicit hide is belt-and-suspenders for the pointer-events:auto popover.
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

  function placeBox(r, selected) {
    box.style.transform = "translate(" + r.left + "px," + r.top + "px)";
    box.style.width = Math.max(0, r.width) + "px"; box.style.height = Math.max(0, r.height) + "px";
    box.classList.toggle("is-selected", !!selected);
    box.classList.add("is-shown");
  }
  function placeChip(r, id) {
    chipName.textContent = id.componentName || id.tagName;
    chipTag.textContent = id.componentName ? ("\\u00b7 " + id.tagName) : "";
    var below = r.bottom + 6;
    var top = (below + 27 <= window.innerHeight) ? below : Math.max(6, r.top - 29);
    var centerX = Math.min(window.innerWidth - 12, Math.max(12, r.left + r.width / 2));
    chip.style.left = centerX + "px"; chip.style.top = top + "px";
    chip.classList.add("is-shown");
  }
  // Class-driven visibility (never inline opacity): a stale inline opacity:0
  // would outrank the class rule and keep the box hidden on the next enable.
  function clearHover() { box.classList.remove("is-shown"); chip.classList.remove("is-shown"); }

  function openPopover(r, id) {
    popLabel.textContent = id.componentName || id.tagName;
    var width = 332, height = 132;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    var top = r.bottom + 10;
    if (top + height > window.innerHeight) { top = Math.max(8, r.top - height - 10); }
    popover.style.left = left + "px"; popover.style.top = top + "px";
    popover.classList.add("is-open");
    popInput.value = "";
    setTimeout(function () { try { popInput.focus(); } catch (e) {} }, 30);
  }
  function closePopover() { popover.classList.remove("is-open"); }

  // Cancel the current selection entirely (Esc / after hand-off): close the
  // popover, drop the selected state + its box styling, and return focus to the
  // page so hover/selection can resume immediately.
  function deselect() {
    closePopover();
    state.selected = null;
    box.classList.remove("is-selected");
    try { popInput.blur(); } catch (e) {}
  }

  // True when the pointer sits over the open popover card (its own input/button
  // own those events; we must not re-target or intercept there).
  function overUi(e) {
    if (!popover.classList.contains("is-open")) { return false; }
    var r = popover.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function emit(kind, el, seedText) {
    if (!el || !el.isConnected) { return; }
    var p = payloadOf(el); p.kind = kind; if (seedText) { p.seedText = seedText; }
    events.push(p);
  }

  function onMove(e) {
    if (!state.on) { return; }
    // Keep previewing other elements while the popover is open (so a single
    // click can smoothly retarget) — but never re-target when the pointer is
    // over the popover card itself.
    if (overUi(e)) { return; }
    var el = targetAt(e.clientX, e.clientY);
    if (!el || el === state.hovered) { return; }
    state.hovered = el;
    var r = el.getBoundingClientRect(); var id = identify(el);
    placeBox(r, state.selected === el); placeChip(r, id);
  }
  function onClick(e) {
    if (!state.on) { return; }
    // Clicks inside the popover belong to its input/button — leave them be.
    if (overUi(e)) { return; }
    var el = targetAt(e.clientX, e.clientY);
    if (!el) { return; }
    e.preventDefault(); e.stopPropagation();
    state.selected = el; state.hovered = el;
    var r = el.getBoundingClientRect(); var id = identify(el);
    // Box + chip + popover all snap (and CSS-glide) to the newly clicked target.
    placeBox(r, true); placeChip(r, id); openPopover(r, id);
  }
  function onKey(e) {
    if (!state.on) { return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
      var el = state.selected || state.hovered;
      if (el) { e.preventDefault(); e.stopPropagation(); emit("add", el, popInput.value.trim() || undefined); deselect(); }
    } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); deselect(); }
  }
  function submitPopover() {
    if (state.selected) { emit("submit", state.selected, popInput.value.trim() || undefined); deselect(); }
  }
  popSend.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); submitPopover(); });
  popInput.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPopover(); }
    else if (e.key === "Escape") { e.preventDefault(); deselect(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
      e.preventDefault(); if (state.selected) { emit("add", state.selected, popInput.value.trim() || undefined); deselect(); }
    }
  });
  popInput.addEventListener("input", function () {
    popInput.style.height = "auto"; popInput.style.height = Math.min(132, popInput.scrollHeight) + "px";
  });

  // ── Scroll lock ────────────────────────────────────────────────────────
  // While Design Mode is on the page must not scroll (so highlight geometry,
  // which is viewport-relative, stays valid and selection is deliberate).
  // overflow:hidden stops the scrollbar + keyboard scroll of the document;
  // capturing wheel/touchmove also stops nested scroll containers. Scrolling
  // INSIDE our own popover (a long prompt) is still allowed via composedPath.
  var savedOverflow = null;
  function overUiPath(e) {
    return typeof e.composedPath === "function" && e.composedPath().indexOf(host) >= 0;
  }
  function onWheel(e) { if (!overUiPath(e)) { e.preventDefault(); } }
  function onTouchMove(e) { if (!overUiPath(e)) { e.preventDefault(); } }
  function lockScroll() {
    if (savedOverflow) { return; }
    var de = document.documentElement, b = document.body;
    savedOverflow = { de: de ? de.style.overflow : "", b: b ? b.style.overflow : "" };
    if (de) { de.style.overflow = "hidden"; }
    if (b) { b.style.overflow = "hidden"; }
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
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
  }

  function bind() {
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }
  function unbind() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  }

  window.__modusDesignOverlay = {
    setEnabled: function (on) {
      attach(); state.on = !!on;
      if (state.on) { bind(); lockScroll(); }
      else {
        unbind(); unlockScroll(); clearHover(); closePopover();
        box.classList.remove("is-selected"); state.hovered = null; state.selected = null;
      }
      return true;
    },
    setTheme: function (t) {
      if (!t) { return true; }
      var s = host.style;
      if (t.accent) s.setProperty("--mdo-accent", t.accent);
      if (t.accentSoft) s.setProperty("--mdo-accent-soft", t.accentSoft);
      if (t.accentContrast) s.setProperty("--mdo-accent-contrast", t.accentContrast);
      if (t.surface) s.setProperty("--mdo-surface", t.surface);
      if (t.elevated) s.setProperty("--mdo-elevated", t.elevated);
      if (t.fg) s.setProperty("--mdo-fg", t.fg);
      if (t.fgSubtle) s.setProperty("--mdo-fg-subtle", t.fgSubtle);
      if (t.border) s.setProperty("--mdo-border", t.border);
      if (t.shadow) s.setProperty("--mdo-shadow", t.shadow);
      if (t.fill) s.setProperty("--mdo-fill", t.fill);
      return true;
    },
    takeEvents: function () { var out = events.slice(); events.length = 0; return JSON.stringify(out); },
    isEnabled: function () { return state.on; },
  };
  return true;
})();
`;
