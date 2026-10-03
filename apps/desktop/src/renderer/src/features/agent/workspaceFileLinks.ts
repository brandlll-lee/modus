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
    const url = new URL(path);
    path = decodeURIComponent(url.hostname ? `//${url.hostname}${url.pathname}` : url.pathname);
    if (/^\/[a-zA-Z]:/.test(path)) {
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

export function workspaceImagePath(src: string): string | undefined {
  const path = workspacePathFromHref(src);
  if (src.startsWith("file:")) return path;
  if (!src || (!path && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src))) return undefined;
  try {
    return decodeURIComponent(path ?? src);
  } catch {
    return path ?? src;
  }
}

/**
 * Before sanitize: rewrite workspace path hrefs to the https sentinel so they
 * are not stripped (f: scheme) and rehype-harden never emits " [blocked]".
 */
export function rehypeWorkspaceFiles() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      const property = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : undefined;
      if (!property) return;
      const href = node.properties?.[property];
      if (typeof href !== "string") {
        return;
      }
      const path = node.tagName === "img" ? workspaceImagePath(href) : workspacePathFromHref(href);
      if (!path) {
        return;
      }
      node.properties[property] = toModusFileHref(path);
    });
  };
}
