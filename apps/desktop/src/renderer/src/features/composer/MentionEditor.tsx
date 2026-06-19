import {
  type ClipboardEvent,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContextItem } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";
import { TokenContent } from "./composerTokens";

export type MentionEditorHandle = {
  focus(): void;
  clear(): void;
  /** Replace `replaceLen` chars before the caret (the "@query") with an inline token. */
  insertToken(item: ContextItem, replaceLen: number): void;
  /** Replace all content with plain text (slash-command prefix seeding). */
  setText(text: string): void;
  insertText(text: string): void;
};

type MentionEditorProps = {
  className?: string;
  /** Fired on every edit with the plain text (tokens excluded) + inline tokens in order. */
  onChange(text: string, items: ContextItem[]): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onPaste(event: ClipboardEvent<HTMLDivElement>): void;
};

/**
 * A contenteditable composer input where @-mentions are inline, atomic
 * (`contenteditable=false`) tokens — so a reference reads as part of the line,
 * e.g. `⎇Branch what is this?` (Cursor parity). The element is uncontrolled
 * (React never rewrites it mid-edit, which would fight the caret/IME); edits are
 * read out of the DOM on input and reported via `onChange`.
 */
export const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
  function MentionEditor({ className, onChange, onKeyDown, onPaste }, ref) {
    const elementRef = useRef<HTMLDivElement>(null);
    // Inline tokens can't carry an object in the DOM, so the element holds an id
    // and the item lives here, keyed by that id.
    const itemsRef = useRef<Map<string, ContextItem>>(new Map());
    const composingRef = useRef(false);

    /** Read text (tokens excluded, `<br>` → newline) + tokens in document order. */
    const read = useCallback((): { text: string; items: ContextItem[] } => {
      const root = elementRef.current;
      if (!root) {
        return { text: "", items: [] };
      }
      let text = "";
      const items: ContextItem[] = [];
      const walk = (node: Node): void => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent ?? "";
          } else if (child instanceof HTMLElement) {
            const tokenId = child.dataset.tokenId;
            if (tokenId) {
              const item = itemsRef.current.get(tokenId);
              if (item) {
                items.push(item);
              }
            } else if (child.tagName === "BR") {
              text += "\n";
            } else {
              walk(child);
            }
          }
        }
      };
      walk(root);
      return { text, items };
    }, []);

    const emit = useCallback((): void => {
      const { text, items } = read();
      // Drop map entries whose tokens were deleted from the DOM.
      const liveIds = new Set(
        Array.from(elementRef.current?.querySelectorAll("[data-token-id]") ?? []).map(
          (el) => (el as HTMLElement).dataset.tokenId,
        ),
      );
      for (const id of itemsRef.current.keys()) {
        if (!liveIds.has(id)) {
          itemsRef.current.delete(id);
        }
      }
      onChange(text, items);
    }, [read, onChange]);

    const buildToken = useCallback((item: ContextItem): HTMLElement => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      itemsRef.current.set(id, item);
      const span = document.createElement("span");
      span.dataset.tokenId = id;
      span.contentEditable = "false";
      span.className = "mr-0.5 inline-flex select-none align-baseline";
      span.innerHTML = renderToStaticMarkup(<TokenContent item={item} />);
      return span;
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => elementRef.current?.focus(),
        clear: () => {
          if (elementRef.current) {
            elementRef.current.innerHTML = "";
          }
          itemsRef.current.clear();
          onChange("", []);
        },
        setText: (text: string) => {
          const root = elementRef.current;
          if (!root) return;
          root.textContent = text;
          itemsRef.current.clear();
          // Caret to end.
          const range = document.createRange();
          range.selectNodeContents(root);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          emit();
        },
        insertText: (text: string) => {
          elementRef.current?.focus();
          document.execCommand("insertText", false, text);
          emit();
        },
        insertToken: (item: ContextItem, replaceLen: number) => {
          const root = elementRef.current;
          const sel = window.getSelection();
          if (!root || !sel || sel.rangeCount === 0) return;
          const range = sel.getRangeAt(0);
          // Delete the trailing "@query" sitting right before the caret.
          if (replaceLen > 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
            const offset = range.startOffset;
            const from = Math.max(0, offset - replaceLen);
            range.setStart(range.startContainer, from);
            range.deleteContents();
          }
          const token = buildToken(item);
          range.insertNode(token);
          // A trailing space so typing continues after the atom.
          const space = document.createTextNode("\u00a0");
          token.after(space);
          range.setStartAfter(space);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          root.focus();
          emit();
        },
      }),
      [buildToken, emit, onChange],
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
        onPaste={onPaste}
        ref={elementRef}
        role="textbox"
        suppressContentEditableWarning
        tabIndex={0}
      />
    );
  },
);
