import type { FileChange } from "../../../../shared/contracts";

/**
 * Tree projection of a flat change list for the list↔tree layout toggle. This
 * is a pure transform over paths — no git knowledge, no per-type branching — so
 * it works for working-tree files and commit files alike. Single-child folder
 * chains are compacted ("src/main/app.ts" → one "src/main" node) to match the
 * VS Code / Cursor "compact folders" behaviour.
 */
export type ChangeTreeNode =
  | { kind: "file"; change: FileChange }
  | { kind: "dir"; name: string; path: string; children: ChangeTreeNode[] };

type DirAccumulator = {
  dirs: Map<string, DirAccumulator>;
  files: FileChange[];
};

function emptyDir(): DirAccumulator {
  return { dirs: new Map(), files: [] };
}

export function buildChangeTree(changes: FileChange[]): ChangeTreeNode[] {
  const root = emptyDir();

  for (const change of changes) {
    const segments = change.path.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = segments.pop();
    if (fileName === undefined) continue;
    let cursor = root;
    for (const segment of segments) {
      let next = cursor.dirs.get(segment);
      if (!next) {
        next = emptyDir();
        cursor.dirs.set(segment, next);
      }
      cursor = next;
    }
    cursor.files.push(change);
  }

  return materialize(root, "");
}

/** Turn the accumulator into sorted nodes (dirs first, then files), compacting chains. */
function materialize(dir: DirAccumulator, prefix: string): ChangeTreeNode[] {
  const dirNodes: ChangeTreeNode[] = [];
  for (const [name, child] of [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let compactName = name;
    let compactPrefix = prefix ? `${prefix}/${name}` : name;
    let node = child;
    // Compact a folder that holds exactly one subfolder and no files of its own.
    while (node.dirs.size === 1 && node.files.length === 0) {
      const [onlyName, onlyChild] = [...node.dirs.entries()][0] as [string, DirAccumulator];
      compactName = `${compactName}/${onlyName}`;
      compactPrefix = `${compactPrefix}/${onlyName}`;
      node = onlyChild;
    }
    dirNodes.push({
      kind: "dir",
      name: compactName,
      path: compactPrefix,
      children: materialize(node, compactPrefix),
    });
  }

  const fileNodes: ChangeTreeNode[] = dir.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((change) => ({ kind: "file", change }));

  return [...dirNodes, ...fileNodes];
}
