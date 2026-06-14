import { browserDebugLog } from "../debug";
import type { CdpSession } from "./session";
import type { SnapshotRefTarget } from "./snapshot";

/**
 * Trusted page input via CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent` /
 * `insertText`.
 *
 * The previous implementation drove the page with `element.click()` inside
 * `executeJavaScript`: events arrived with `isTrusted=false` (filtered by many
 * consent managers), nothing verified the element was actually hittable, and
 * `webContents.sendInputEvent` — used for coordinate clicks — silently does
 * nothing when the window is unfocused. CDP input runs hit-testing in the
 * browser process, produces `isTrusted` events, routes into OOPIF iframes
 * automatically, works without window focus, and uses CSS-pixel viewport
 * coordinates end to end (matching snapshots and screenshots).
 *
 * Before acting on an element we run the Playwright-style actionability
 * pipeline: scroll into view → visible (non-empty content quads) → stable
 * (position settled across two reads) → receives events (hit-test lands on the
 * element or a descendant; otherwise the error names the obscuring node).
 */

export interface Point {
  x: number;
  y: number;
}

export type MouseButton = "left" | "right" | "middle";

export interface ClickOptions {
  button?: MouseButton;
  doubleClick?: boolean;
  modifiers?: string[];
}

const BUTTON_MASKS: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };

const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

/** Named keys → CDP key descriptors (Windows virtual key codes). */
const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  f1: { key: "F1", code: "F1", keyCode: 112 },
  f2: { key: "F2", code: "F2", keyCode: 113 },
  f3: { key: "F3", code: "F3", keyCode: 114 },
  f4: { key: "F4", code: "F4", keyCode: 115 },
  f5: { key: "F5", code: "F5", keyCode: 116 },
  f6: { key: "F6", code: "F6", keyCode: 117 },
  f7: { key: "F7", code: "F7", keyCode: 118 },
  f8: { key: "F8", code: "F8", keyCode: 119 },
  f9: { key: "F9", code: "F9", keyCode: 120 },
  f10: { key: "F10", code: "F10", keyCode: 121 },
  f11: { key: "F11", code: "F11", keyCode: 122 },
  f12: { key: "F12", code: "F12", keyCode: 123 },
};

function modifierMask(modifiers: string[] | undefined): number {
  let mask = 0;
  for (const name of modifiers ?? []) {
    mask |= MODIFIER_BITS[name.toLowerCase()] ?? 0;
  }
  return mask;
}

/* ── Geometry helpers ─────────────────────────────────────────────────── */

function quadToPoints(quad: number[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < quad.length; i += 2) {
    const x = quad[i];
    const y = quad[i + 1];
    if (typeof x === "number" && typeof y === "number") {
      points.push({ x, y });
    }
  }
  return points;
}

function quadArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) {
      area += (a.x * b.y - b.x * a.y) / 2;
    }
  }
  return Math.abs(area);
}

function quadCenter(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  const count = Math.max(1, points.length);
  return { x: x / count, y: y / count };
}

async function contentQuadCenter(
  session: CdpSession,
  backendNodeId: number,
  sessionId: string | undefined,
): Promise<Point | undefined> {
  const result = await session.send<{ quads?: number[][] }>(
    "DOM.getContentQuads",
    { backendNodeId },
    sessionId,
  );
  for (const rawQuad of result.quads ?? []) {
    const points = quadToPoints(rawQuad);
    if (points.length === 4 && quadArea(points) > 1) {
      return quadCenter(points);
    }
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── Node descriptions for actionable error messages ──────────────────── */

interface DescribedNode {
  nodeName?: string;
  attributes?: string[];
}

async function describeForError(
  session: CdpSession,
  backendNodeId: number,
  sessionId: string | undefined,
): Promise<string> {
  try {
    const result = await session.send<{ node?: DescribedNode }>(
      "DOM.describeNode",
      { backendNodeId },
      sessionId,
    );
    const node = result.node;
    if (!node?.nodeName) {
      return "another element";
    }
    const attrs = node.attributes ?? [];
    let id = "";
    let className = "";
    for (let i = 0; i + 1 < attrs.length; i += 2) {
      if (attrs[i] === "id") {
        id = attrs[i + 1] ?? "";
      } else if (attrs[i] === "class") {
        className = attrs[i + 1] ?? "";
      }
    }
    let description = `<${node.nodeName.toLowerCase()}`;
    if (id) {
      description += ` id="${id}"`;
    }
    if (className) {
      description += ` class="${className.split(/\s+/).slice(0, 3).join(" ")}"`;
    }
    return `${description}>`;
  } catch {
    return "another element";
  }
}

/* ── Actionability + target resolution ────────────────────────────────── */

async function resolveObjectId(
  session: CdpSession,
  backendNodeId: number,
  sessionId: string | undefined,
): Promise<string> {
  const result = await session.send<{ object?: { objectId?: string } }>(
    "DOM.resolveNode",
    { backendNodeId },
    sessionId,
  );
  const objectId = result.object?.objectId;
  if (!objectId) {
    throw new Error(
      "Element is no longer attached to the document — take a fresh browser_snapshot.",
    );
  }
  return objectId;
}

/**
 * Top-left offset of the iframe owning an OOPIF child session, in root
 * viewport CSS pixels. Single-level deep: a cross-origin iframe nested inside
 * another cross-origin iframe will resolve against the root and may be off —
 * acceptable for now, the dominant real-world case is one level.
 */
async function frameOffset(session: CdpSession, frameId: string): Promise<Point> {
  try {
    const owner = await session.send<{ backendNodeId?: number }>("DOM.getFrameOwner", { frameId });
    if (typeof owner.backendNodeId !== "number") {
      return { x: 0, y: 0 };
    }
    const result = await session.send<{ quads?: number[][] }>("DOM.getContentQuads", {
      backendNodeId: owner.backendNodeId,
    });
    const firstQuad = result.quads?.[0];
    if (!firstQuad) {
      return { x: 0, y: 0 };
    }
    const points = quadToPoints(firstQuad);
    if (points.length === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: Math.min(...points.map((point) => point.x)),
      y: Math.min(...points.map((point) => point.y)),
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

const STABILITY_READS = 3;
const STABILITY_INTERVAL_MS = 40;

/**
 * Resolve a snapshot ref to a clickable point in root-viewport CSS pixels,
 * enforcing visible → stable → receives-events along the way.
 */
export async function resolveActionPoint(
  session: CdpSession,
  target: SnapshotRefTarget,
  options: { skipHitTestCheck?: boolean } = {},
): Promise<Point> {
  await session.ensureAttached();
  const { backendNodeId, sessionId } = target;

  try {
    await session.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId);
  } catch {
    throw new Error(
      `Element "${target.role}${target.name ? ` ${JSON.stringify(target.name)}` : ""}" is no longer in the document — take a fresh browser_snapshot.`,
    );
  }

  // Visible + stable: the position must settle across consecutive reads so we
  // do not click mid-animation (e.g. a banner still sliding in).
  let center = await contentQuadCenter(session, backendNodeId, sessionId);
  if (!center) {
    throw new Error(
      `Element "${target.role}${target.name ? ` ${JSON.stringify(target.name)}` : ""}" is not visible (zero-size or hidden). It may be collapsed or display:none.`,
    );
  }
  for (let read = 1; read < STABILITY_READS; read += 1) {
    await delay(STABILITY_INTERVAL_MS);
    const next = await contentQuadCenter(session, backendNodeId, sessionId);
    if (!next) {
      throw new Error("Element became invisible while preparing to interact with it.");
    }
    if (Math.abs(next.x - center.x) < 1 && Math.abs(next.y - center.y) < 1) {
      center = next;
      break;
    }
    center = next;
  }

  // Translate OOPIF-local coordinates into the root viewport.
  if (sessionId && target.frameId) {
    const offset = await frameOffset(session, target.frameId);
    center = { x: center.x + offset.x, y: center.y + offset.y };
  }

  // Receives-events: hit-test the click point from the top document. Only
  // meaningful for root-session targets (for OOPIFs the top-document hit is
  // the <iframe> element itself, which is expected).
  if (!sessionId && !options.skipHitTestCheck) {
    await assertReceivesEvents(session, target, center);
  }

  return { x: Math.round(center.x * 100) / 100, y: Math.round(center.y * 100) / 100 };
}

async function assertReceivesEvents(
  session: CdpSession,
  target: SnapshotRefTarget,
  point: Point,
): Promise<void> {
  let hitBackendNodeId: number | undefined;
  try {
    const hit = await session.send<{ backendNodeId?: number }>("DOM.getNodeForLocation", {
      x: Math.round(point.x),
      y: Math.round(point.y),
      includeUserAgentShadowDOM: false,
    });
    hitBackendNodeId = hit.backendNodeId;
  } catch {
    // Hit test unavailable (e.g. point outside viewport after scroll race) —
    // do not block the action on it.
    return;
  }
  if (hitBackendNodeId === undefined || hitBackendNodeId === target.backendNodeId) {
    return;
  }

  // Containment check that walks out of shadow roots, so a hit on a node
  // inside the target's shadow DOM still counts as the target.
  try {
    const targetObject = await resolveObjectId(session, target.backendNodeId, undefined);
    const hitObject = await resolveObjectId(session, hitBackendNodeId, undefined);
    const result = await session.send<{ result?: { value?: unknown } }>("Runtime.callFunctionOn", {
      objectId: targetObject,
      functionDeclaration: `function(hit) {
        const related = (a, b) => {
          let node = b;
          while (node) {
            if (node === a) return true;
            node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
          }
          return false;
        };
        return related(this, hit) || related(hit, this);
      }`,
      arguments: [{ objectId: hitObject }],
      returnByValue: true,
    });
    if (result.result?.value === true) {
      return;
    }
  } catch {
    // If the relationship check itself fails, fall through to the error below.
  }

  const blocker = await describeForError(session, hitBackendNodeId, undefined);
  throw new Error(
    `Element "${target.role}${target.name ? ` ${JSON.stringify(target.name)}` : ""}" is obscured by ${blocker} at its click point — it would not receive the click. ` +
      `Close or dismiss the covering element first (take a browser_snapshot to see it).`,
  );
}

/* ── Mouse actions ─────────────────────────────────────────────────────── */

async function dispatchMouse(session: CdpSession, params: Record<string, unknown>): Promise<void> {
  await session.send("Input.dispatchMouseEvent", { pointerType: "mouse", ...params });
}

/** Debug-only probe: what does the page think lives at this viewport point? */
async function probePoint(session: CdpSession, point: Point): Promise<void> {
  try {
    const result = await session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: `(() => {
        const el = document.elementFromPoint(${Math.round(point.x)}, ${Math.round(point.y)});
        if (!el) return "(nothing)";
        const rect = el.getBoundingClientRect();
        return el.tagName + (el.id ? "#" + el.id : "") +
          (el.className && typeof el.className === "string" ? "." + el.className.split(/\\s+/).slice(0, 2).join(".") : "") +
          " @" + Math.round(rect.x) + "," + Math.round(rect.y) + " " + Math.round(rect.width) + "x" + Math.round(rect.height) +
          " | viewport " + window.innerWidth + "x" + window.innerHeight + " dpr=" + window.devicePixelRatio;
      })()`,
      returnByValue: true,
    });
    browserDebugLog("input", `hit probe @${point.x},${point.y}`, result.result?.value);
  } catch (error) {
    browserDebugLog("input", "hit probe failed", String(error));
  }
}

export async function clickAtPoint(
  session: CdpSession,
  point: Point,
  options: ClickOptions = {},
): Promise<void> {
  await session.ensureAttached();
  const button = options.button ?? "left";
  const clickCount = options.doubleClick ? 2 : 1;
  const modifiers = modifierMask(options.modifiers);
  const base = { x: point.x, y: point.y, modifiers };

  await probePoint(session, point);
  await dispatchMouse(session, { ...base, type: "mouseMoved", button: "none", buttons: 0 });
  for (let count = 1; count <= clickCount; count += 1) {
    await dispatchMouse(session, {
      ...base,
      type: "mousePressed",
      button,
      buttons: BUTTON_MASKS[button],
      clickCount: count,
    });
    await dispatchMouse(session, {
      ...base,
      type: "mouseReleased",
      button,
      buttons: 0,
      clickCount: count,
    });
  }
  browserDebugLog("input", `dispatched ${button} click @${point.x},${point.y} x${clickCount}`);
}

/** Trusted hover (mouse move) at a pre-resolved viewport point. */
export async function hoverAtPoint(session: CdpSession, point: Point): Promise<void> {
  await session.ensureAttached();
  await dispatchMouse(session, {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
    modifiers: 0,
  });
}

const DRAG_STEPS = 12;

export async function dragBetweenPoints(
  session: CdpSession,
  start: Point,
  end: Point,
): Promise<void> {
  await session.ensureAttached();
  await dispatchMouse(session, {
    type: "mouseMoved",
    x: start.x,
    y: start.y,
    button: "none",
    buttons: 0,
  });
  await dispatchMouse(session, {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    const t = step / DRAG_STEPS;
    await dispatchMouse(session, {
      type: "mouseMoved",
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      button: "left",
      buttons: 1,
    });
    await delay(12);
  }
  await dispatchMouse(session, {
    type: "mouseReleased",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

/** Trusted wheel scroll. CDP deltas follow DOM semantics: +y scrolls down. */
export async function scrollAtPoint(
  session: CdpSession,
  point: Point,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await session.ensureAttached();
  await dispatchMouse(session, {
    type: "mouseWheel",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
    modifiers: 0,
    deltaX,
    deltaY,
  });
}

/* ── Keyboard actions ─────────────────────────────────────────────────── */

function keyDescriptor(rawKey: string): {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
} {
  const named = NAMED_KEYS[rawKey.toLowerCase()];
  if (named) {
    return named;
  }
  if (rawKey.length === 1) {
    const upper = rawKey.toUpperCase();
    const isLetter = upper >= "A" && upper <= "Z";
    const isDigit = rawKey >= "0" && rawKey <= "9";
    return {
      key: rawKey,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${rawKey}` : "",
      keyCode: isLetter || isDigit ? upper.charCodeAt(0) : rawKey.charCodeAt(0),
      text: rawKey,
    };
  }
  // Unknown named key: pass through and let the renderer interpret `key`.
  return { key: rawKey, code: rawKey, keyCode: 0 };
}

/**
 * Press a key or combination, e.g. "Enter", "a", "Control+A", "Shift+Tab".
 * Dispatched on the session owning keyboard focus (child session for OOPIFs).
 */
export async function pressKeyCombo(
  session: CdpSession,
  combo: string,
  sessionId?: string,
): Promise<void> {
  await session.ensureAttached();
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("Empty key combination.");
  }
  const keyPart = parts[parts.length - 1] ?? "";
  const modifierParts = parts.slice(0, -1);
  const modifiers = modifierMask(modifierParts);
  const descriptor = keyDescriptor(keyPart);

  const down: Record<string, unknown> = {
    type: "keyDown",
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.keyCode,
    nativeVirtualKeyCode: descriptor.keyCode,
    modifiers,
  };
  // Text (→ char event) only when the combo can actually produce a character:
  // Ctrl/Meta chords are commands, not text input. (Ctrl bit = 2, Meta bit = 4)
  if (descriptor.text !== undefined && (modifiers & (2 | 4)) === 0) {
    down.text = descriptor.text;
  }
  await session.send("Input.dispatchKeyEvent", down, sessionId);
  await session.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyUp",
      key: descriptor.key,
      code: descriptor.code,
      windowsVirtualKeyCode: descriptor.keyCode,
      nativeVirtualKeyCode: descriptor.keyCode,
      modifiers,
    },
    sessionId,
  );
}

/** Type text into the focused element by per-character trusted key events. */
export async function typeText(
  session: CdpSession,
  text: string,
  sessionId?: string,
): Promise<void> {
  await session.ensureAttached();
  for (const char of text) {
    if (char === "\n" || char === "\r") {
      await pressKeyCombo(session, "Enter", sessionId);
      continue;
    }
    const descriptor = keyDescriptor(char);
    await session.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: descriptor.key,
        code: descriptor.code,
        windowsVirtualKeyCode: descriptor.keyCode,
        nativeVirtualKeyCode: descriptor.keyCode,
        text: char,
        modifiers: 0,
      },
      sessionId,
    );
    await session.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: descriptor.key,
        code: descriptor.code,
        windowsVirtualKeyCode: descriptor.keyCode,
        nativeVirtualKeyCode: descriptor.keyCode,
        modifiers: 0,
      },
      sessionId,
    );
  }
}

/* ── Form helpers ─────────────────────────────────────────────────────── */

/**
 * Focus an element, select its current contents, and replace them via
 * `Input.insertText` (a trusted composition-style insert that fires real
 * `input` events, so frameworks like React observe the change).
 */
export async function fillRef(
  session: CdpSession,
  target: SnapshotRefTarget,
  value: string,
): Promise<void> {
  // Visibility/stability checks; hit-test is irrelevant for focus-based input.
  await resolveActionPoint(session, target, { skipHitTestCheck: true });
  const { backendNodeId, sessionId } = target;

  await session.send("DOM.focus", { backendNodeId }, sessionId);

  const objectId = await resolveObjectId(session, backendNodeId, sessionId);
  await session.send(
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: `function() {
        if (typeof this.select === "function") {
          this.select();
          return;
        }
        const root = this.getRootNode();
        const selection = root.getSelection ? root.getSelection() : window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(this);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }`,
      returnByValue: true,
    },
    sessionId,
  );

  if (value.length > 0) {
    await session.send("Input.insertText", { text: value }, sessionId);
  } else {
    await pressKeyCombo(session, "Delete", sessionId);
  }
}

/** Select <option>s by value, label, or visible text; returns matched values. */
export async function selectOptionRef(
  session: CdpSession,
  target: SnapshotRefTarget,
  values: string[],
): Promise<string[]> {
  await resolveActionPoint(session, target, { skipHitTestCheck: true });
  const objectId = await resolveObjectId(session, target.backendNodeId, target.sessionId);
  const result = await session.send<{
    result?: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string } };
  }>(
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: `function(values) {
        const element = this.tagName === "SELECT" ? this : this.closest("select");
        if (!element) throw new Error("Element is not a <select>.");
        const wanted = new Set(values);
        const matches = (option) =>
          wanted.has(option.value) ||
          wanted.has(option.label.trim()) ||
          wanted.has((option.textContent ?? "").trim());
        const selected = [];
        let firstDone = false;
        for (const option of Array.from(element.options)) {
          const match = matches(option) && (element.multiple || !firstDone);
          option.selected = match;
          if (match) {
            selected.push(option.value);
            firstDone = true;
          }
        }
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return selected;
      }`,
      arguments: [{ value: values }],
      returnByValue: true,
    },
    target.sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "select_option failed");
  }
  const selected = result.result?.value;
  return Array.isArray(selected) ? selected.map((entry) => String(entry)) : [];
}
