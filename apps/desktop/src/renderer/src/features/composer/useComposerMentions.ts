import { useEffect, useMemo, useState } from "react";
import type { ContextSuggestion } from "../../../../shared/contracts";

type UseComposerMentionsInput = {
  value: string;
  workspaceId: string | undefined;
  cwd: string | undefined;
};

function getMentionQuery(value: string): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([^\s]*)$/.exec(value);
  if (!match || match.index === undefined) {
    return undefined;
  }

  return {
    start: match.index + match[0].indexOf("@"),
    query: match[1] ?? "",
  };
}

export function useComposerMentions({ value, workspaceId, cwd }: UseComposerMentionsInput) {
  const mention = useMemo(() => getMentionQuery(value), [value]);
  const [suggestions, setSuggestions] = useState<ContextSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const isOpen = Boolean(mention && workspaceId && cwd);

  useEffect(() => {
    if (!mention || !workspaceId || !cwd) {
      setSuggestions([]);
      setActiveIndex(0);
      return;
    }

    let cancelled = false;
    void window.modus.context
      .search({ workspaceId, cwd, query: mention.query })
      .then((items: ContextSuggestion[]) => {
        if (!cancelled) {
          setSuggestions(items);
          setActiveIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, mention, workspaceId]);

  return {
    activeIndex,
    isOpen: isOpen && suggestions.length > 0,
    mention,
    setActiveIndex,
    suggestions,
  };
}
