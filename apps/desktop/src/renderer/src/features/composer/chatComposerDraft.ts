import type { ContextItem } from "../../../../shared/contracts";
import { type ComposerDraft, createEmptyComposerDraft } from "./composerDraft";
import { contextItemKey } from "./composerTokens";

export type ChatComposerDraft = ComposerDraft & {
  contextItems: ContextItem[];
};

export type ChatComposerDraftUpdate =
  | ChatComposerDraft
  | ((current: ChatComposerDraft) => ChatComposerDraft);

export function createEmptyChatComposerDraft(): ChatComposerDraft {
  return { ...createEmptyComposerDraft(), contextItems: [] };
}

export function addContextItemToDraft(
  draft: ChatComposerDraft,
  item: ContextItem,
): ChatComposerDraft {
  const key = contextItemKey(item);
  if (draft.contextItems.some((contextItem) => contextItemKey(contextItem) === key)) {
    return draft;
  }
  return {
    ...draft,
    contextItems: [...draft.contextItems, item],
    parts: [
      ...(draft.parts ?? [
        ...draft.contextItems.map((contextItem) => ({
          type: "context" as const,
          item: contextItem,
        })),
        ...(draft.value ? [{ type: "text" as const, text: `${draft.value}\n` }] : []),
      ]),
      { type: "context" as const, item },
    ],
  };
}
