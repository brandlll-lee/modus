import type { Root } from "hast";
import { visit } from "unist-util-visit";

/** App-owned https sentinel — survives rehype-sanitize; never navigated. */
export const MODUS_FILE_HREF_PREFIX = "https://modus.workspace/file";

/** Windows abs / file: / leading-slash drive — path grammar, not a name list. */
export function isWorkspaceFileHref(href: string): boolean {
  if (href.startsWith("file:")) {
    return true;
  }
  if (/^[a-zA-Z]:[\\/]/.test(href)) {
    return true;
  }
  return /^\/[a-zA-Z]:[\\/]/.test(href);
}

/** Normalize model link targets to a filesystem path (drop :line citation suffix). */
export function workspacePathFromHref(href: string): string | undefined {
  if (!isWorkspaceFileHref(href)) {
    return undefined;
  }
  let path = href;
  if (path.startsWith("file:")) {
    path = decodeURIComponent(path.replace(/^file:\/\//i, ""));
    if (path.startsWith("/")) {
      // file:///F:/x → /F:/x → F:/x
      path = path.slice(1);
    }
  } else if (path.startsWith("/") && /^\/[a-zA-Z]:/.test(path)) {
    path = path.slice(1);
  }
  return path.replace(/:\d+(?:-\d+)?$/, "");
}

export function toModusFileHref(path: string): string {
  return `${MODUS_FILE_HREF_PREFIX}?path=${encodeURIComponent(path)}`;
}

export function parseModusFileHref(href: string | undefined): string | undefined {
  if (!href?.startsWith(MODUS_FILE_HREF_PREFIX)) {
    return undefined;
  }
  try {
    return new URL(href).searchParams.get("path") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Before sanitize: rewrite workspace path hrefs to the https sentinel so they
 * are not stripped (f: scheme) and rehype-harden never emits " [blocked]".
 */
export function rehypeWorkspaceFileLinks() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "a") {
        return;
      }
      const href = node.properties?.href;
      if (typeof href !== "string") {
        return;
      }
      const path = workspacePathFromHref(href);
      if (!path) {
        return;
      }
      node.properties.href = toModusFileHref(path);
    });
  };
}
