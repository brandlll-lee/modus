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

function inlinePartLabel(part: MentionEditorPart): string | undefined {
  if (part.type === "context") {
    // Design marks keep a short in-flow label. Every other context kind is shown
    // via chips; the model payload travels on `context[]` IPC — omit from body.
    if (part.item.type === "design-element") {
      return (
        part.item.element.componentName || part.item.element.tagName || part.item.element.label
      );
    }
    if (part.item.type === "design-annotation") {
      return part.item.annotation.label;
    }
    return "";
  }
  if (part.type === "skill") {
    return `skill:${part.skill.name}`;
  }
  return undefined;
}

export function messageFromParts(parts: MentionEditorPart[] | undefined, fallback: string): string {
  if (!parts || parts.length === 0) {
    return fallback;
  }
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      const label = inlinePartLabel(part);
      if (label === "") {
        return "";
      }
      return `[${label ?? "context"}]`;
    })
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
