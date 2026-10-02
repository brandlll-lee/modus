import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContextItem, ContextKind } from "../../../../shared/contracts";
export type MentionRow = {
  id: string;
  label: string;
  detail: string;
  icon: ContextKind;
  item: ContextItem;
};
export function useComposerMentions({
  value,
  cwd,
}: {
  value: string;
  workspaceId?: string | undefined;
  cwd?: string | undefined;
}) {
  const mention = useMemo(() => {
    const match = /(?:^|\s)@([^\s]*)$/.exec(value);
    return match
      ? { start: match.index + match[0].indexOf("@"), query: match[1] ?? "" }
      : undefined;
  }, [value]);
  const [rows, setRows] = useState<MentionRow[]>([]),
    [activeIndex, setActiveIndex] = useState(0);
  const query = mention?.query;
  useEffect(() => {
    if (query === undefined || !cwd) {
      setRows([]);
      return;
    }
    let active = true;
    const normalized = query.replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    const directory = slash < 0 ? undefined : normalized.slice(0, slash + 1);
    const needle = normalized.slice(slash + 1).toLowerCase();
    void window.modus.files
      .list({ cwd, ...(directory ? { dir: directory } : {}) })
      .then((entries) => {
        if (active) {
          setRows(
            entries
              .filter((entry) => entry.name.toLowerCase().startsWith(needle))
              .map((entry) => ({
                id: entry.path,
                label: entry.name,
                detail: entry.relativePath,
                icon: entry.kind === "directory" ? "folder" : "file",
                item: { type: entry.kind === "directory" ? "folder" : "file", path: entry.path },
              })),
          );
          setActiveIndex(0);
        }
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [cwd, query]);
  const moveActive = useCallback(
    (delta: number) =>
      setActiveIndex((index) => (rows.length ? (index + delta + rows.length) % rows.length : 0)),
    [rows.length],
  );
  return {
    mention,
    rows,
    activeIndex,
    setActiveIndex,
    moveActive,
    isOpen: Boolean(mention && rows.length),
  };
}
