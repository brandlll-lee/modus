import { browserDebugLog } from "../debug";
import type { CdpSession } from "./session";

/**
 * Accessibility-tree page snapshots.
 *
 * Replaces the old `executeJavaScript` + `querySelectorAll` scraper, which
 * could not see into shadow roots (Usercentrics-style cookie banners) or
 * iframes (OneTrust-style banners), capped out at 160 elements, and polluted
 * the page by writing `data-modus-browser-ref` attributes into the DOM.
 *
 * The CDP `Accessibility.getFullAXTree` view pierces shadow DOM natively and
 * is serialized here into the Playwright ARIA-snapshot dialect
 * (`- role "name" [ref=eN]`) that models are already trained on. Cross-origin
 * iframes are captured through their own flat CDP child sessions and appended
 * as labelled sections. Refs map to `backendNodeId`s held in main-process
 * memory only — nothing is written into the page.
 */

/* ── CDP Accessibility shapes (subset we consume) ─────────────────────── */

export interface AXValue {
  type?: string;
  value?: unknown;
}

export interface AXProperty {
  name: string;
  value?: AXValue;
}

export interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: AXValue;
  name?: AXValue;
  value?: AXValue;
  properties?: AXProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

/* ── Ref registry (per tab, generation-scoped) ────────────────────────── */

export interface SnapshotRefTarget {
  backendNodeId: number;
  /** OOPIF child session owning the node; undefined → root session. */
  sessionId?: string;
  /** CDP frameId of the owning frame (used to offset OOPIF coordinates). */
  frameId?: string;
  role: string;
  name: string;
}

export class SnapshotStore {
  private generation = 0;
  private refs = new Map<string, SnapshotRefTarget>();

  beginGeneration(): number {
    this.generation += 1;
    this.refs.clear();
    return this.generation;
  }

  addRef(ref: string, target: SnapshotRefTarget): void {
    this.refs.set(ref, target);
  }

  /** Cross-document navigation invalidates every outstanding ref. */
  invalidate(): void {
    this.refs.clear();
  }

  get size(): number {
    return this.refs.size;
  }

  resolve(ref: string): SnapshotRefTarget {
    const target = this.refs.get(ref);
    if (!target) {
      throw new Error(
        `Element ref "${ref}" is stale or unknown — the page changed or was re-snapshotted. ` +
          `Take a fresh browser_snapshot and use a ref from that result.`,
      );
    }
    return target;
  }
}

/* ── Pure AX-tree serialization (unit-testable, no CDP dependency) ────── */

/** Roles whose entire subtree carries no information for an agent. */
const SKIP_SUBTREE_ROLES = new Set(["inlinetextbox", "linebreak", "listmarker", "scrollbar"]);

/** Document containers: never emitted, children keep the current depth. */
const DOCUMENT_ROLES = new Set(["rootwebarea", "webarea"]);

/** Layout wrappers: emitted only when named/focusable/editable. */
const TRANSPARENT_ROLES = new Set([
  "generic",
  "genericcontainer",
  "none",
  "presentation",
  "iframepresentational",
  "section",
]);

/** Roles an agent can act on → these get `[ref=eN]` handles. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "treeitem",
  "listbox",
  "popupbutton",
  "togglebutton",
  "disclosuretriangle",
]);

/** Roles whose `value` is worth printing inline (current input contents). */
const VALUE_ROLES = new Set(["textbox", "searchbox", "combobox", "slider", "spinbutton"]);

const MAX_NAME_LENGTH = 160;

function axString(value: AXValue | undefined): string {
  if (!value || value.value === undefined || value.value === null) {
    return "";
  }
  return String(value.value);
}

function propertyValue(node: AXNode, name: string): unknown {
  const property = node.properties?.find((entry) => entry.name === name);
  return property?.value?.value;
}

function truncateName(name: string): string {
  const collapsed = name.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_NAME_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_NAME_LENGTH - 1)}…`;
}

function stateSuffix(node: AXNode): string {
  const states: string[] = [];
  if (propertyValue(node, "disabled") === true) {
    states.push("[disabled]");
  }
  const checked = propertyValue(node, "checked");
  if (checked === "true" || checked === true) {
    states.push("[checked]");
  } else if (checked === "mixed") {
    states.push("[checked=mixed]");
  }
  const pressed = propertyValue(node, "pressed");
  if (pressed === "true" || pressed === true) {
    states.push("[pressed]");
  }
  if (propertyValue(node, "expanded") === true) {
    states.push("[expanded]");
  }
  if (propertyValue(node, "selected") === true) {
    states.push("[selected]");
  }
  if (propertyValue(node, "required") === true) {
    states.push("[required]");
  }
  const level = propertyValue(node, "level");
  if (typeof level === "number") {
    states.push(`[level=${level}]`);
  }
  return states.length > 0 ? ` ${states.join(" ")}` : "";
}

function isEditable(node: AXNode): boolean {
  const editable = propertyValue(node, "editable");
  return editable === "richtext" || editable === "plaintext" || editable === true;
}

function isFocusable(node: AXNode): boolean {
  return propertyValue(node, "focusable") === true;
}

export interface SerializeAxTreeOptions {
  /** Stop emitting once this many lines were produced (token budget). */
  maxLines: number;
  /** Stop descending below this depth. */
  maxDepth: number;
  /**
   * Called for nodes an agent can interact with; returning a ref id attaches
   * `[ref=...]` to the line. Return undefined to leave the node un-addressable
   * (e.g. when it has no backing DOM node).
   */
  assignRef: (node: AXNode) => string | undefined;
}

export interface SerializedAxTree {
  lines: string[];
  truncated: boolean;
}

/** Serialize a flat `getFullAXTree` node list into ARIA-snapshot text. */
export function serializeAxTree(
  nodes: AXNode[],
  options: SerializeAxTreeOptions,
): SerializedAxTree {
  const byId = new Map<string, AXNode>();
  const referencedAsChild = new Set<string>();
  for (const node of nodes) {
    byId.set(node.nodeId, node);
    for (const childId of node.childIds ?? []) {
      referencedAsChild.add(childId);
    }
  }
  const roots = nodes.filter((node) => !referencedAsChild.has(node.nodeId));

  const lines: string[] = [];
  let truncated = false;

  const emitChildren = (node: AXNode, depth: number): void => {
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) {
        visit(child, depth);
      }
    }
  };

  const visit = (node: AXNode, depth: number): void => {
    if (truncated) {
      return;
    }
    const role = axString(node.role);
    const roleKey = role.toLowerCase();

    if (SKIP_SUBTREE_ROLES.has(roleKey)) {
      return;
    }
    // "ignored" means hidden from assistive tech, NOT an empty subtree —
    // Chromium routinely marks wrapper nodes ignored while their children are
    // the page's real content. Treat them as transparent; pruning here used to
    // produce completely empty snapshots (refs: 0) on real-world pages.
    if (node.ignored || DOCUMENT_ROLES.has(roleKey)) {
      emitChildren(node, depth);
      return;
    }

    const name = truncateName(axString(node.name));

    if (roleKey === "statictext") {
      // Bare text whose content was not rolled up into a parent's name.
      if (name.length > 0) {
        pushLine(depth, `- text "${name}"`);
      }
      return;
    }

    const focusable = isFocusable(node);
    const editable = isEditable(node);
    if (TRANSPARENT_ROLES.has(roleKey) && !focusable && !editable && name.length === 0) {
      // Pure layout wrapper: flatten it away but keep walking.
      emitChildren(node, depth);
      return;
    }

    let line = `- ${role}`;
    if (name.length > 0) {
      line += ` "${name}"`;
    }

    const interactive = INTERACTIVE_ROLES.has(roleKey) || focusable || editable;
    if (interactive) {
      const ref = options.assignRef(node);
      if (ref) {
        line += ` [ref=${ref}]`;
      }
    }

    line += stateSuffix(node);

    if (VALUE_ROLES.has(roleKey)) {
      const value = truncateName(axString(node.value));
      if (value.length > 0) {
        line += `: "${value}"`;
      }
    }

    pushLine(depth, line);
    if (depth + 1 <= options.maxDepth) {
      emitChildren(node, depth + 1);
    }
  };

  const pushLine = (depth: number, text: string): void => {
    if (lines.length >= options.maxLines) {
      truncated = true;
      return;
    }
    lines.push(`${"  ".repeat(depth)}${text}`);
  };

  for (const root of roots) {
    visit(root, 0);
  }

  return { lines, truncated };
}

/* ── CDP orchestration ────────────────────────────────────────────────── */

interface FrameTreeNode {
  frame: { id: string; url?: string };
  childFrames?: FrameTreeNode[];
}

export interface CaptureSnapshotOptions {
  maxLines?: number;
  maxDepth?: number;
}

export interface BrowserSnapshotResult {
  text: string;
  refCount: number;
  truncated: boolean;
}

const DEFAULT_MAX_LINES = 1200;
const DEFAULT_MAX_DEPTH = 48;

/** Collect same-process descendant frames (OOPIFs live in child sessions). */
function collectChildFrames(
  tree: FrameTreeNode | undefined,
  oopifFrameIds: Set<string>,
  into: { id: string; url: string }[],
  isRoot: boolean,
): void {
  if (!tree) {
    return;
  }
  if (!isRoot && !oopifFrameIds.has(tree.frame.id)) {
    into.push({ id: tree.frame.id, url: tree.frame.url ?? "" });
  }
  for (const child of tree.childFrames ?? []) {
    collectChildFrames(child, oopifFrameIds, into, false);
  }
}

export async function captureSnapshot(
  session: CdpSession,
  store: SnapshotStore,
  page: { url: string; title: string },
  options: CaptureSnapshotOptions = {},
): Promise<BrowserSnapshotResult> {
  await session.ensureAttached();
  store.beginGeneration();

  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  let refCounter = 0;
  let truncated = false;
  let budget = maxLines;

  const makeAssignRef = (sessionId: string | undefined, frameId: string | undefined) => {
    return (node: AXNode): string | undefined => {
      if (typeof node.backendDOMNodeId !== "number") {
        return undefined;
      }
      refCounter += 1;
      const ref = `e${refCounter}`;
      store.addRef(ref, {
        backendNodeId: node.backendDOMNodeId,
        role: axString(node.role),
        name: truncateName(axString(node.name)),
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(frameId !== undefined ? { frameId } : {}),
      });
      return ref;
    };
  };

  const sections: string[] = [];

  const serializeFrame = async (
    label: string | undefined,
    nodes: AXNode[],
    sessionId: string | undefined,
    frameId: string | undefined,
  ): Promise<void> => {
    if (budget <= 0) {
      truncated = true;
      return;
    }
    const result = serializeAxTree(nodes, {
      maxLines: budget,
      maxDepth,
      assignRef: makeAssignRef(sessionId, frameId),
    });
    truncated = truncated || result.truncated;
    budget -= result.lines.length;
    if (result.lines.length === 0) {
      return;
    }
    sections.push(label ? `${label}\n${result.lines.join("\n")}` : result.lines.join("\n"));
  };

  // 1. Main document (pierces shadow DOM natively).
  const rootTree = await session.send<{ nodes?: AXNode[] }>("Accessibility.getFullAXTree");
  await serializeFrame(undefined, rootTree.nodes ?? [], undefined, undefined);

  // 2. Same-process child frames: separate AX documents inside the same target.
  const oopifFrameIds = new Set<string>();
  for (const childSessionId of session.childSessionIds()) {
    const frameId = session.frameIdForSession(childSessionId);
    if (frameId) {
      oopifFrameIds.add(frameId);
    }
  }
  try {
    const frameTree = await session.send<{ frameTree?: FrameTreeNode }>("Page.getFrameTree");
    const childFrames: { id: string; url: string }[] = [];
    collectChildFrames(frameTree.frameTree, oopifFrameIds, childFrames, true);
    for (const frame of childFrames) {
      try {
        const tree = await session.send<{ nodes?: AXNode[] }>("Accessibility.getFullAXTree", {
          frameId: frame.id,
        });
        await serializeFrame(
          `\niframe ${frame.url || frame.id}:`,
          tree.nodes ?? [],
          undefined,
          frame.id,
        );
      } catch {
        // Frame may have detached mid-walk; skip it.
      }
    }
  } catch {
    // Frame tree unavailable (page tearing down); main document already captured.
  }

  // 3. Cross-origin iframes via their flat child sessions.
  for (const childSessionId of session.childSessionIds()) {
    const frameId = session.frameIdForSession(childSessionId);
    let frameUrl = "";
    try {
      const childTree = await session.send<{ frameTree?: FrameTreeNode }>(
        "Page.getFrameTree",
        {},
        childSessionId,
      );
      frameUrl = childTree.frameTree?.frame.url ?? "";
    } catch {
      // Child session may be mid-navigation; still try the AX tree below.
    }
    try {
      const tree = await session.send<{ nodes?: AXNode[] }>(
        "Accessibility.getFullAXTree",
        {},
        childSessionId,
      );
      await serializeFrame(
        `\niframe (cross-origin) ${frameUrl || frameId || childSessionId}:`,
        tree.nodes ?? [],
        childSessionId,
        frameId,
      );
    } catch {
      // Session detached; skip.
    }
  }

  const header = [`Page URL: ${page.url}`, `Page title: ${page.title}`];
  if (truncated) {
    header.push("(snapshot truncated — increase specificity or scroll to the area of interest)");
  }
  const text = `${header.join("\n")}\n\n${sections.join("\n")}`;

  browserDebugLog("snapshot", "captured", {
    url: page.url,
    rootNodes: (rootTree.nodes ?? []).length,
    refs: refCounter,
    childSessions: session.childSessionIds().length,
    sections: sections.length,
    truncated,
  });

  return { text, refCount: refCounter, truncated };
}
