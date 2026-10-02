import type { SkillSelection } from "../../../../shared/contracts";
import type { MentionEditorPart } from "./MentionEditor";
import type { ComposerImage } from "./useComposerImages";

export type ComposerDraft = {
  value: string;
  images: ComposerImage[];
  selectedSkills: SkillSelection[];
  parts?: MentionEditorPart[] | undefined;
};

export type ComposerDraftUpdate = ComposerDraft | ((current: ComposerDraft) => ComposerDraft);

export function createEmptyComposerDraft(): ComposerDraft {
  return { value: "", images: [], selectedSkills: [] };
}

export function messageFromParts(parts: MentionEditorPart[] | undefined, fallback: string): string {
  if (!parts?.length) return fallback;
  return parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function resolveDraftUpdate<T>(update: T | ((current: T) => T), current: T): T {
  return typeof update === "function" ? (update as (value: T) => T)(current) : update;
}

export function restoreQueuedDraft(draft: ComposerDraft, messages: string[]): ComposerDraft {
  const text = messages.filter((message) => message.trim()).join("\n\n");
  if (!text) return draft;
  const prefix = `${text}${draft.value.trim() ? "\n\n" : ""}`;
  return {
    ...draft,
    value: prefix + draft.value,
    parts: [
      { type: "text", text: prefix },
      ...(draft.parts ?? [{ type: "text", text: draft.value }]),
    ],
  };
}
