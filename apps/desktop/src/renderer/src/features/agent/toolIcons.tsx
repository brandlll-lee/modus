import {
  IconFile,
  IconFilePlus,
  IconFileSearch,
  IconFolder,
  IconHierarchy,
  IconListCheck,
  IconPencil,
  IconPlugConnected,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconWorld,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ToolIconName } from "../../../../shared/tools";
import { ModusBot } from "../../components/ui/ModusBot";

/** Maps the shared, serializable icon names to concrete Tabler components. */
const TOOL_ICONS: Record<Exclude<ToolIconName, "modus">, typeof IconFile> = {
  file: IconFile,
  terminal: IconTerminal2,
  pencil: IconPencil,
  "file-plus": IconFilePlus,
  search: IconSearch,
  "file-search": IconFileSearch,
  folder: IconFolder,
  globe: IconWorld,
  hierarchy: IconHierarchy,
  mcp: IconPlugConnected,
  todo: IconListCheck,
  tool: IconTool,
};

export function toolIcon(name: ToolIconName): ReactNode {
  if (name === "modus") {
    return <ModusBot active={false} className="size-3.5" color="currentColor" />;
  }
  const Glyph = TOOL_ICONS[name] ?? IconTool;
  return <Glyph size={14} stroke={1.7} />;
}
