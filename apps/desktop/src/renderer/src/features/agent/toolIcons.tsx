import {
  IconFile,
  IconFilePlus,
  IconFileSearch,
  IconFolder,
  IconListCheck,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconWorld,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ToolIconName } from "../../../../shared/tools";

/** Maps the shared, serializable icon names to concrete Tabler components. */
const TOOL_ICONS: Record<ToolIconName, typeof IconFile> = {
  file: IconFile,
  terminal: IconTerminal2,
  pencil: IconPencil,
  "file-plus": IconFilePlus,
  search: IconSearch,
  "file-search": IconFileSearch,
  folder: IconFolder,
  globe: IconWorld,
  todo: IconListCheck,
  tool: IconTool,
};

export function toolIcon(name: ToolIconName): ReactNode {
  const Glyph = TOOL_ICONS[name] ?? IconTool;
  return <Glyph size={14} stroke={1.7} />;
}
