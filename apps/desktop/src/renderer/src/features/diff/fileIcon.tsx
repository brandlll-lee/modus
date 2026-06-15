import {
  IconBraces,
  IconFile,
  IconFileCode,
  IconFileTypeCss,
  IconFileTypeHtml,
  IconFileTypeJs,
  IconFileTypeJsx,
  IconFileTypeRs,
  IconFileTypeSvg,
  IconFileTypeTs,
  IconFileTypeTsx,
  IconJson,
  IconMarkdown,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";

type TablerIcon = ComponentType<IconProps>;

/**
 * Extension → glyph lookup. A *data* table, not a branch ladder: a new file type
 * is one entry, and an unknown extension falls back to the generic file glyph
 * (proven by the test feeding a never-listed extension). Aliases (mjs→js, yml→
 * yaml) collapse to one icon by pointing at the same component.
 */
const EXT_ICON: Record<string, TablerIcon> = {
  tsx: IconFileTypeTsx,
  ts: IconFileTypeTs,
  mts: IconFileTypeTs,
  cts: IconFileTypeTs,
  jsx: IconFileTypeJsx,
  js: IconFileTypeJs,
  mjs: IconFileTypeJs,
  cjs: IconFileTypeJs,
  css: IconFileTypeCss,
  html: IconFileTypeHtml,
  svg: IconFileTypeSvg,
  rs: IconFileTypeRs,
  json: IconJson,
  md: IconMarkdown,
  mdx: IconMarkdown,
  toml: IconBraces,
  yaml: IconBraces,
  yml: IconBraces,
  lock: IconFileCode,
  config: IconFileCode,
  conf: IconFileCode,
};

/** Special-cased exact file names that have no telling extension. */
const NAME_ICON: Record<string, TablerIcon> = {
  "package.json": IconJson,
  "package-lock.json": IconJson,
  dockerfile: IconFileCode,
  makefile: IconFileCode,
};

/** Resolve the icon component for a path (exported for unit testing the lookup). */
export function iconComponentForPath(path: string): TablerIcon {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? path.toLowerCase();
  const byName = NAME_ICON[name];
  if (byName) return byName;
  const ext = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
  return EXT_ICON[ext] ?? IconFile;
}

export function iconForPath(
  path: string,
  props: IconProps = { size: 16, stroke: 1.65 },
): ReactNode {
  const Icon = iconComponentForPath(path);
  return <Icon {...props} />;
}

/** Generic fallback glyph, exported so tests can assert the fallback path. */
export const FALLBACK_FILE_ICON = IconFile;
