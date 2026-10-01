import type {
  AgentMode,
  BrowserEvent,
  ContextItem,
  PromptImageAttachment,
} from "../../../../shared/contracts";
import { type ComposerDraft, createEmptyComposerDraft, messageFromParts } from "./composerDraft";
import { contextItemKey } from "./composerTokens";
import type { MentionEditorPart } from "./MentionEditor";

type DesignContextItem = Extract<ContextItem, { type: "design-element" }>;
type DesignAnnotationContextItem = Extract<ContextItem, { type: "design-annotation" }>;

export type ChatComposerDraft = ComposerDraft & {
  contextItems: ContextItem[];
  mode: AgentMode;
};

export type ChatComposerDraftUpdate =
  | ChatComposerDraft
  | ((current: ChatComposerDraft) => ChatComposerDraft);

export function createEmptyChatComposerDraft(): ChatComposerDraft {
  return { ...createEmptyComposerDraft(), contextItems: [], mode: "build" };
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

export function addDesignElementToDraft(
  draft: ChatComposerDraft,
  event: Extract<BrowserEvent, { type: "browser.design-select" }>,
): ChatComposerDraft {
  const sourceElements = event.element.elements ?? [event.element];
  const referencedIndices = event.element.contentParts
    ? Array.from(
        new Set(
          event.element.contentParts
            .filter((part) => part.type === "element")
            .map((part) => part.index),
        ),
      ).filter((index) => sourceElements[index])
    : sourceElements.map((_, index) => index);
  const designItems: DesignContextItem[] =
    event.element.elements && event.element.elements.length > 0
      ? referencedIndices.flatMap((sourceIndex, index): DesignContextItem[] => {
          const part = sourceElements[sourceIndex];
          if (!part) {
            return [];
          }
          return [
            {
              type: "design-element",
              element: {
                ...part,
                id: `${event.element.id}:${sourceIndex}`,
                tabId: event.element.tabId,
                url: event.element.url,
                ...(index === 0 && referencedIndices.length > 1
                  ? {
                      elements: referencedIndices.flatMap((itemIndex) => {
                        const item = sourceElements[itemIndex];
                        return item ? [item] : [];
                      }),
                    }
                  : {}),
                ...(index === 0 && event.element.screenshotDataUrl
                  ? { screenshotDataUrl: event.element.screenshotDataUrl }
                  : {}),
              },
            },
          ];
        })
      : referencedIndices.length > 0
        ? [{ type: "design-element", element: event.element }]
        : [];
  const existingIds = new Set(
    draft.contextItems
      .filter((item) => item.type === "design-element")
      .map((item) => item.element.id),
  );
  const nextContextItems = [
    ...draft.contextItems,
    ...designItems.filter((item) => !existingIds.has(item.element.id)),
  ];
  const nextImages =
    event.element.screenshotDataUrl && !draft.images.some((image) => image.id === event.element.id)
      ? [
          ...draft.images,
          {
            id: event.element.id,
            name: `${event.element.label}.png`,
            mimeType: "image/png",
            dataUrl: event.element.screenshotDataUrl,
          },
        ]
      : draft.images;
  const text = event.seedText?.trim();
  const insertedItems = designItems.filter((item) => !existingIds.has(item.element.id));
  const nextValue = text
    ? draft.value.trim()
      ? `${draft.value.trimEnd()}\n${text}`
      : text
    : draft.value;
  const designParts: MentionEditorPart[] | undefined = event.element.contentParts?.flatMap(
    (part): MentionEditorPart[] => {
      if (part.type === "text") {
        return part.text ? [{ type: "text", text: part.text }] : [];
      }
      const singleId = part.index === 0 ? event.element.id : undefined;
      const multiId = `${event.element.id}:${part.index}`;
      const item =
        insertedItems.find(
          (candidate) => candidate.element.id === multiId || candidate.element.id === singleId,
        ) ??
        designItems.find(
          (candidate) => candidate.element.id === multiId || candidate.element.id === singleId,
        ) ??
        (part.index === 0 ? (insertedItems[0] ?? designItems[0]) : undefined);
      return item ? [{ type: "context", item }] : [];
    },
  );
  const nextParts =
    designParts && designParts.length > 0
      ? [
          ...(draft.parts ?? [
            ...draft.contextItems.map((item) => ({ type: "context" as const, item })),
            ...(draft.value ? [{ type: "text" as const, text: `${draft.value}\n` }] : []),
          ]),
          ...designParts,
        ]
      : draft.parts;
  return {
    ...draft,
    contextItems: nextContextItems,
    images: nextImages,
    parts: nextParts,
    value: nextValue,
  };
}

export function addDesignAnnotationToDraft(
  draft: ChatComposerDraft,
  event: Extract<BrowserEvent, { type: "browser.design-annotate" }>,
): ChatComposerDraft {
  const item: DesignAnnotationContextItem = {
    type: "design-annotation",
    annotation: event.annotation,
  };
  const exists = draft.contextItems.some(
    (contextItem) =>
      contextItem.type === "design-annotation" && contextItem.annotation.id === event.annotation.id,
  );
  const nextContextItems = exists ? draft.contextItems : [...draft.contextItems, item];
  const nextImages =
    event.annotation.screenshotDataUrl &&
    !draft.images.some((image) => image.id === event.annotation.id)
      ? [
          ...draft.images,
          {
            id: event.annotation.id,
            name: `${event.annotation.label}.png`,
            mimeType: "image/png",
            dataUrl: event.annotation.screenshotDataUrl,
          },
        ]
      : draft.images;
  const text = event.annotation.seedText?.trim();
  const nextValue = text
    ? draft.value.trim()
      ? `${draft.value.trimEnd()}\n${text}`
      : text
    : draft.value;
  const nextParts = exists
    ? draft.parts
    : [
        ...(draft.parts ?? [
          ...draft.contextItems.map((contextItem) => ({
            type: "context" as const,
            item: contextItem,
          })),
          ...(draft.value ? [{ type: "text" as const, text: `${draft.value}\n` }] : []),
        ]),
        { type: "context" as const, item },
        ...(text ? [{ type: "text" as const, text }] : []),
      ];
  return {
    ...draft,
    contextItems: nextContextItems,
    images: nextImages,
    parts: nextParts,
    value: nextValue,
  };
}

export function designEventToPromptInput(
  event: Extract<BrowserEvent, { type: "browser.design-select" | "browser.design-annotate" }>,
): {
  message: string;
  context: ContextItem[];
  attachments?: PromptImageAttachment[] | undefined;
  mode: AgentMode;
} {
  const draft =
    event.type === "browser.design-select"
      ? addDesignElementToDraft(createEmptyChatComposerDraft(), event)
      : addDesignAnnotationToDraft(createEmptyChatComposerDraft(), event);
  const hasInlineText = draft.parts?.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
  const message =
    draft.value.trim() || hasInlineText
      ? messageFromParts(draft.parts, draft.value.trim())
      : draft.images.length > 0
        ? "See the selected design context."
        : "Use the selected design context.";
  const attachments = draft.images.map((image) => ({
    type: "image" as const,
    data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1),
    mimeType: image.mimeType,
    name: image.name,
  }));
  return {
    message,
    context: draft.contextItems,
    ...(attachments.length > 0 ? { attachments } : {}),
    mode: draft.mode,
  };
}
