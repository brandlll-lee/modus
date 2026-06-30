import { generateManifest } from "material-icon-theme";
import type { FileEntry } from "../../../../shared/contracts";

const MATERIAL_ICON_PREFIX = "../../../../../../../node_modules/material-icon-theme/icons/";

const materialIconManifest = generateManifest();
const materialIconModules = import.meta.glob<string>(
  "../../../../../../../node_modules/material-icon-theme/icons/*.svg",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

export function materialIconForEntry(entry: FileEntry, expanded: boolean): string | undefined {
  const name = entry.name.toLowerCase();
  const id =
    entry.kind === "directory"
      ? expanded
        ? (materialIconManifest.folderNamesExpanded?.[name] ?? materialIconManifest.folderExpanded)
        : (materialIconManifest.folderNames?.[name] ?? materialIconManifest.folder)
      : iconIdForFile(entry.relativePath);
  return id ? materialIconUrl(id) : undefined;
}

export function materialIconForFile(path: string): string | undefined {
  const id = iconIdForFile(path);
  return id ? materialIconUrl(id) : undefined;
}

function iconIdForFile(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const name = normalized.split("/").at(-1) ?? normalized;
  const byName =
    materialIconManifest.fileNames?.[name] ?? materialIconManifest.fileNames?.[normalized];
  if (byName) return byName;

  const parts = name.split(".");
  for (let index = 1; index < parts.length; index += 1) {
    const suffix = parts.slice(index).join(".");
    const byExtension = materialIconManifest.fileExtensions?.[suffix];
    if (byExtension) return byExtension;
  }
  return materialIconManifest.file;
}

function materialIconUrl(id: string): string | undefined {
  const iconPath = materialIconManifest.iconDefinitions?.[id]?.iconPath;
  const fileName = iconPath?.split("/").at(-1);
  return fileName ? materialIconModules[`${MATERIAL_ICON_PREFIX}${fileName}`] : undefined;
}
