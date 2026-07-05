import {
  type ClipboardEvent,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IconX } from "@tabler/icons-react";
import type { ContextItem, SkillSelection } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";
import { contextItemKey, SkillTokenContent, TokenContent } from "./composerTokens";

export type MentionEditorHandle = {
  focus(): void;
  clear(): void;
  /** Replace `replaceLen` chars before the caret (the "@query") with an inline token. */
  insertContextToken(item: ContextItem, replaceLen: number): void;
  insertSkillToken(skill: SkillSelection, replaceLen: number): void;
  /** Replace all content with plain text (slash-command prefix seeding). */
  setText(text: string): void;
  insertText(text: string, replaceLen?: number): void;
  deleteBeforeCaret(replaceLen: number): void;
};

export type MentionEditorPart =
  | { type: "text"; text: string }
  | { type: "context"; item: ContextItem }
  | { type: "skill"; skill: SkillSelection };

type MentionEditorProps = {
  className?: string;
  value: string;
  contextItems: ContextItem[];
  skills: SkillSelection[];
  parts?: MentionEditorPart[] | undefined;
  /** Fired on every edit with the plain text (tokens excluded) + inline tokens in order. */
  onChange(
    text: string,
    items: ContextItem[],
    skills: SkillSelection[],
    textBeforeCaret: string,
    parts: MentionEditorPart[],
  ): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onPaste(event: ClipboardEvent<HTMLDivElement>): void;
};

type InlineToken =
  | { kind: "context"; item: ContextItem }
  | { kind: "skill"; skill: SkillSelection };

function skillKey(skill: SkillSelection): string {
  return skill.path;
}

function snapshot(text: string, items: ContextItem[], skills: SkillSelection[]): string {
  return JSON.stringify({
    text,
    items: items.map(contextItemKey),
    skills: skills.map(skillKey),
  });
}

/**
 * A contenteditable composer input where @-mentions are inline, atomic
 * (`contenteditable=false`) tokens — so a reference reads as part of the line,
 * e.g. `⎇Branch what is this?` (Cursor parity). The element is uncontrolled
 * (React never rewrites it mid-edit, which would fight the caret/IME); edits are
 * read out of the DOM on input and reported via `onChange`.
 */
export const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
  function MentionEditor(
    { className, value, contextItems, skills, parts, onChange, onKeyDown, onPaste },
    ref,
  ) {
    const elementRef = useRef<HTMLDivElement>(null);
    // Inline tokens can't carry an object in the DOM, so the element holds an id
    // and the item lives here, keyed by that id.
    const tokensRef = useRef<Map<string, InlineToken>>(new Map());
    const composingRef = useRef(false);
    const lastSnapshotRef = useRef("");

    const textFromNode = useCallback((node: Node): string => {
      let text = "";
      const walk = (current: Node): void => {
        for (const child of Array.from(current.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            text += (child.textContent ?? "").replace(/\u00a0/g, " ");
          } else if (child instanceof HTMLElement) {
            if (child.dataset.tokenId) {
              continue;
            }
            if (child.tagName === "BR") {
              text += "\n";
            } else {
              walk(child);
            }
          } else {
            walk(child);
          }
        }
      };
      walk(node);
      return text;
    }, []);

    /** Read text (tokens excluded, `<br>` → newline) + tokens in document order. */
    const read = useCallback(
      (): {
        text: string;
        items: ContextItem[];
        skills: SkillSelection[];
        parts: MentionEditorPart[];
      } => {
        const root = elementRef.current;
        if (!root) {
          return { text: "", items: [], skills: [], parts: [] };
        }
        let text = "";
        const items: ContextItem[] = [];
        const selectedSkills: SkillSelection[] = [];
        const parts: MentionEditorPart[] = [];
        const pushText = (value: string): void => {
          const normalized = value.replace(/\u00a0/g, " ");
          if (!normalized) {
            return;
          }
          text += normalized;
          const last = parts.at(-1);
          if (last?.type === "text") {
            last.text += normalized;
          } else {
            parts.push({ type: "text", text: normalized });
          }
        };
        const walk = (node: Node): void => {
          for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
              pushText(child.textContent ?? "");
            } else if (child instanceof HTMLElement) {
              const tokenId = child.dataset.tokenId;
              if (tokenId) {
                const token = tokensRef.current.get(tokenId);
                if (token?.kind === "context") {
                  items.push(token.item);
                  parts.push({ type: "context", item: token.item });
                } else if (token?.kind === "skill") {
                  selectedSkills.push(token.skill);
                  parts.push({ type: "skill", skill: token.skill });
                }
              } else if (child.tagName === "BR") {
                pushText("\n");
              } else {
                walk(child);
              }
            }
          }
        };
        walk(root);
        return { text, items, skills: selectedSkills, parts };
      },
      [],
    );

    const textBeforeCaret = useCallback((): string => {
      const root = elementRef.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0) {
        return read().text;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.startContainer)) {
        return read().text;
      }
      const before = document.createRange();
      before.selectNodeContents(root);
      before.setEnd(range.startContainer, range.startOffset);
      return textFromNode(before.cloneContents());
    }, [read, textFromNode]);

    const emit = useCallback((): void => {
      const { text, items, skills, parts } = read();
      // Drop map entries whose tokens were deleted from the DOM.
      const liveIds = new Set(
        Array.from(elementRef.current?.querySelectorAll("[data-token-id]") ?? []).map(
          (el) => (el as HTMLElement).dataset.tokenId,
        ),
      );
      for (const id of tokensRef.current.keys()) {
        if (!liveIds.has(id)) {
          tokensRef.current.delete(id);
        }
      }
      lastSnapshotRef.current = snapshot(text, items, skills);
      onChange(text, items, skills, textBeforeCaret(), parts);
    }, [read, onChange, textBeforeCaret]);

    const buildToken = useCallback((token: InlineToken): HTMLElement => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      tokensRef.current.set(id, token);
      const span = document.createElement("span");
      span.dataset.tokenId = id;
      span.contentEditable = "false";
      span.className =
        "group/token mr-0.5 inline-flex select-none items-center rounded-full bg-[#dcebfa] px-1.5 align-baseline";
      span.innerHTML = renderToStaticMarkup(
        <>
          {token.kind === "context" ? (
            <TokenContent item={token.item} />
          ) : (
            <SkillTokenContent skill={token.skill} />
          )}
          <span
            aria-hidden="true"
            className="inline-flex w-0 items-center justify-center overflow-hidden rounded-full text-[#2f8edb]/70 opacity-0 transition-[width,opacity] group-hover/token:ml-0.5 group-hover/token:w-3.5 group-hover/token:opacity-100"
            data-token-remove="true"
          >
            <IconX size={10} stroke={2.1} />
          </span>
        </>,
      );
      return span;
    }, []);

    const replaceBeforeCaret = useCallback(
      (replaceLen: number, nodes: Node[]): void => {
        const root = elementRef.current;
        const sel = window.getSelection();
        if (!root || !sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!root.contains(range.startContainer)) return;
        if (replaceLen > 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
          const offset = range.startOffset;
          range.setStart(range.startContainer, Math.max(0, offset - replaceLen));
          range.deleteContents();
        }
        const last = nodes.at(-1);
        if (nodes.length > 0) {
          const fragment = document.createDocumentFragment();
          for (const node of nodes) {
            fragment.append(node);
          }
          range.insertNode(fragment);
        }
        if (last) {
          range.setStartAfter(last);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        root.focus();
        emit();
      },
      [emit],
    );

    const insertInlineToken = useCallback(
      (token: InlineToken, replaceLen: number): void => {
        const el = buildToken(token);
        replaceBeforeCaret(replaceLen, [el, document.createTextNode("\u00a0")]);
      },
      [buildToken, replaceBeforeCaret],
    );

    const partsSnapshot = parts
      ? JSON.stringify(
          parts.map((part) =>
            part.type === "context"
              ? { type: part.type, key: contextItemKey(part.item) }
              : part.type === "skill"
                ? { type: part.type, key: skillKey(part.skill) }
                : part,
          ),
        )
      : undefined;

    useLayoutEffect(() => {
      const nextSnapshot = partsSnapshot ?? snapshot(value, contextItems, skills);
      if (nextSnapshot === lastSnapshotRef.current) {
        return;
      }
      const root = elementRef.current;
      if (!root) {
        return;
      }
      root.innerHTML = "";
      tokensRef.current.clear();
      for (const item of contextItems) {
        if (!parts) {
          root.append(buildToken({ kind: "context", item }), document.createTextNode("\u00a0"));
        }
      }
      for (const skill of skills) {
        if (!parts) {
          root.append(buildToken({ kind: "skill", skill }), document.createTextNode("\u00a0"));
        }
      }
      if (parts) {
        for (const part of parts) {
          if (part.type === "text") {
            root.append(document.createTextNode(part.text));
          } else if (part.type === "context") {
            root.append(buildToken({ kind: "context", item: part.item }), document.createTextNode("\u00a0"));
          } else {
            root.append(buildToken({ kind: "skill", skill: part.skill }), document.createTextNode("\u00a0"));
          }
        }
      } else if (value) {
        root.append(document.createTextNode(value));
      }
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      lastSnapshotRef.current = nextSnapshot;
    }, [buildToken, contextItems, parts, partsSnapshot, skills, value]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => elementRef.current?.focus(),
        clear: () => {
          if (elementRef.current) {
            elementRef.current.innerHTML = "";
          }
          tokensRef.current.clear();
          lastSnapshotRef.current = snapshot("", [], []);
          onChange("", [], [], "", []);
        },
        setText: (text: string) => {
          const root = elementRef.current;
          if (!root) return;
          root.textContent = text;
          tokensRef.current.clear();
          // Caret to end.
          const range = document.createRange();
          range.selectNodeContents(root);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          emit();
        },
        insertText: (text: string, replaceLen = 0) => {
          elementRef.current?.focus();
          replaceBeforeCaret(replaceLen, [document.createTextNode(text)]);
        },
        deleteBeforeCaret: (replaceLen: number) => replaceBeforeCaret(replaceLen, []),
        insertContextToken: (item: ContextItem, replaceLen: number) =>
          insertInlineToken({ kind: "context", item }, replaceLen),
        insertSkillToken: (skill: SkillSelection, replaceLen: number) =>
          insertInlineToken({ kind: "skill", skill }, replaceLen),
      }),
      [emit, insertInlineToken, onChange, replaceBeforeCaret],
    );

    return (
      <div
        className={cn(
          "scroll-thin max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words outline-none",
          className,
        )}
        contentEditable
        onCompositionEnd={() => {
          composingRef.current = false;
          emit();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onInput={() => {
          if (!composingRef.current) {
            emit();
          }
        }}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          const remove = target?.closest("[data-token-remove]");
          const token = remove?.closest("[data-token-id]");
          if (token) {
            event.preventDefault();
            token.remove();
            emit();
          }
        }}
        onPaste={onPaste}
        ref={elementRef}
        role="textbox"
        suppressContentEditableWarning
        tabIndex={0}
      />
    );
  },
);
