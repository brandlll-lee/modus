import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContextItem, ContextKind, ContextSuggestion } from "../../../../shared/contracts";

type UseComposerMentionsInput = {
  value: string;
  workspaceId: string | undefined;
  cwd: string | undefined;
};

/** A drill-in category in the @ menu (lists results when opened). */
type CategoryView = "file" | "past-chat";

/**
 * One rendered row of the @ menu. The menu is a flat list of these; the hook
 * owns navigation (root ⇄ category) and pagination so the view stays dumb.
 */
export type MentionRow =
  | { row: "header"; id: string; label: string }
  | { row: "nav"; id: string; label: string; icon: ContextKind; target: CategoryView }
  | {
      row: "add";
      id: string;
      label: string;
      detail?: string;
      icon: ContextKind;
      item: ContextItem;
    }
  | { row: "more"; id: string; label: string };

/** Fixed top entries of the @ root menu (Cursor parity). Data-driven. */
const ROOT_NAV: ReadonlyArray<{ label: string; icon: ContextKind; target: CategoryView }> = [
  { label: "Files & Folders", icon: "folder", target: "file" },
  { label: "Past Chats", icon: "past-chat", target: "past-chat" },
];

/** How many category results to show before the "Show N more" row. */
const PAGE_SIZE = 3;
/** How many file matches to inline in the root menu. */
const ROOT_FILE_MATCHES = 3;

function getMentionQuery(value: string): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([^\s]*)$/.exec(value);
  if (!match || match.index === undefined) {
    return undefined;
  }
  return { start: match.index + match[0].indexOf("@"), query: match[1] ?? "" };
}

function rowIsSelectable(row: MentionRow): boolean {
  return row.row !== "header";
}

export function isMentionMenuOpen(
  ready: boolean,
  view: "root" | CategoryView,
  rows: MentionRow[],
): boolean {
  return ready && (view !== "root" || rows.some(rowIsSelectable));
}

export function useComposerMentions({ value, workspaceId, cwd }: UseComposerMentionsInput) {
  const mention = useMemo(() => getMentionQuery(value), [value]);
  const query = mention?.query ?? "";
  const ready = Boolean(mention && workspaceId && cwd);

  const [view, setView] = useState<"root" | CategoryView>("root");
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<ContextSuggestion[]>([]);

  // Close → reset navigation so the next @ always starts at root.
  useEffect(() => {
    if (!mention) {
      setView("root");
      setExpanded(false);
    }
  }, [mention]);

  // Fetch the active list: category results for a drill-in, or root file
  // matches at root. Routed by the explicit category (kind) the user opened.
  useEffect(() => {
    if (!ready || !workspaceId || !cwd) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const kind: ContextKind | undefined = view === "past-chat" ? "past-chat" : "file";
    void window.modus.context
      .search({ workspaceId, cwd, query, ...(view !== "root" ? { kind } : {}) })
      .then((items: ContextSuggestion[]) => {
        if (!cancelled) {
          setResults(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, workspaceId, cwd, query, view]);

  const rows = useMemo<MentionRow[]>(() => {
    const needle = query.toLowerCase();
    if (view === "root") {
      const out: MentionRow[] = [];
      // Fixed direct-add entries (always available, filtered by query label).
      const branch: MentionRow = {
        row: "add",
        id: "branch",
        label: "Branch",
        detail: "Use current branch diff as context",
        icon: "git-diff",
        item: { type: "git-diff", mode: "branch" },
      };
      const browser: MentionRow = {
        row: "add",
        id: "browser",
        label: "Browser",
        detail: "Enable browser tools",
        icon: "browser",
        item: { type: "browser", ...(workspaceId ? { workspaceId } : {}) },
      };
      for (const entry of [branch, browser]) {
        if (!needle || entry.label.toLowerCase().includes(needle)) {
          out.push(entry);
        }
      }
      // Inline file matches for the current query (the agent's most common @).
      for (const item of results.slice(0, ROOT_FILE_MATCHES)) {
        out.push(suggestionRow(item));
      }
      // Drill-in categories, filtered by label too.
      for (const nav of ROOT_NAV) {
        if (!needle || nav.label.toLowerCase().includes(needle)) {
          out.push({
            row: "nav",
            id: `nav:${nav.target}`,
            label: nav.label,
            icon: nav.icon,
            target: nav.target,
          });
        }
      }
      return out;
    }

    // Category view: header + paginated results + "Show N more".
    const header = view === "past-chat" ? "Past Chats" : "Files & Folders";
    const out: MentionRow[] = [{ row: "header", id: "header", label: header }];
    const shown = expanded ? results : results.slice(0, PAGE_SIZE);
    for (const item of shown) {
      out.push(suggestionRow(item));
    }
    if (!expanded && results.length > PAGE_SIZE) {
      out.push({ row: "more", id: "more", label: `Show ${results.length - PAGE_SIZE} more` });
    }
    return out;
  }, [view, query, results, expanded, workspaceId]);

  // Keep the highlight on a selectable row whenever the list changes.
  useEffect(() => {
    setActiveIndex((index) => {
      if (rows[index] && rowIsSelectable(rows[index])) {
        return index;
      }
      return rows.findIndex(rowIsSelectable);
    });
  }, [rows]);

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((index) => {
        const count = rows.length;
        if (count === 0) return 0;
        let next = index;
        for (let step = 0; step < count; step += 1) {
          next = (next + delta + count) % count;
          if (rowIsSelectable(rows[next] as MentionRow)) {
            return next;
          }
        }
        return index;
      });
    },
    [rows],
  );

  const openCategory = useCallback((target: CategoryView) => {
    setExpanded(false);
    setView(target);
  }, []);

  const backToRoot = useCallback(() => {
    setExpanded(false);
    setView("root");
  }, []);

  const isOpen = isMentionMenuOpen(ready, view, rows);

  return {
    isOpen,
    mention,
    rows,
    activeIndex,
    setActiveIndex,
    moveActive,
    openCategory,
    backToRoot,
    /** True when Backspace on an empty query should pop back to root. */
    atCategoryRoot: view !== "root" && query.length === 0,
    expandMore: () => setExpanded(true),
  };
}

function suggestionRow(item: ContextSuggestion): MentionRow {
  return {
    row: "add",
    id: item.id,
    label: item.label,
    detail: item.detail,
    icon: item.type,
    item: item.item,
  };
}
