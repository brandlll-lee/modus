import { useEffect, useRef, useState } from "react";

const DEFAULT_PACE_MS = 24;
const DEFAULT_MAX_STEP = 24;
const SNAP_AHEAD = 8;
/** Prefer stopping on punctuation, spaces, or newlines (not mid `**` / list). */
const SNAP_BOUNDARY = /[\p{P}\p{Z}\n]/u;

type SmoothStreamingTextOptions = {
  paceMs?: number;
  maxStep?: number;
};

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function advanceGraphemes(text: string, fromIndex: number, count: number): number {
  if (count <= 0 || fromIndex >= text.length) {
    return Math.min(fromIndex, text.length);
  }
  if (!segmenter) {
    let index = fromIndex;
    for (let consumed = 0; index < text.length && consumed < count; consumed += 1) {
      index += (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    }
    return index;
  }

  const window = text.slice(fromIndex, fromIndex + count * 8 + 8);
  let consumed = 0;
  let endOffset = 0;
  for (const { index, segment } of segmenter.segment(window)) {
    if (consumed >= count) {
      break;
    }
    endOffset = index + segment.length;
    consumed += 1;
  }
  return fromIndex + endOffset;
}

function step(backlog: number, maxStep: number): number {
  if (backlog <= 12) return Math.min(2, maxStep);
  if (backlog <= 48) return Math.min(4, maxStep);
  if (backlog <= 96) return Math.min(8, maxStep);
  return Math.min(maxStep, Math.ceil(backlog / 8));
}

export function nextPacedTextIndex(text: string, start: number, maxStep = DEFAULT_MAX_STEP): number {
  const end = advanceGraphemes(text, start, step(text.length - start, maxStep));
  let cursor = end;
  for (let offset = 0; offset < SNAP_AHEAD && cursor < text.length; offset += 1) {
    const next = advanceGraphemes(text, cursor, 1);
    if (SNAP_BOUNDARY.test(text.slice(cursor, next))) {
      return next;
    }
    cursor = next;
  }
  return end;
}

export function useSmoothStreamingText(
  fullText: string,
  isStreaming: boolean,
  options?: SmoothStreamingTextOptions,
): string {
  const paceMs = Math.max(0, options?.paceMs ?? DEFAULT_PACE_MS);
  const maxStep = Math.max(1, options?.maxStep ?? DEFAULT_MAX_STEP);
  const [visible, setVisible] = useState(fullText);
  const fullRef = useRef(fullText);
  const streamingRef = useRef(isStreaming);
  const shownRef = useRef(fullText);
  const timerRef = useRef<number | undefined>(undefined);
  const runRef = useRef<() => void>(() => undefined);

  fullRef.current = fullText;
  streamingRef.current = isStreaming;
  runRef.current = () => {
    timerRef.current = undefined;
    const text = fullRef.current;
    const shown = shownRef.current;
    if (!streamingRef.current || !text.startsWith(shown) || text.length <= shown.length) {
      shownRef.current = text;
      setVisible(text);
      return;
    }

    const end = nextPacedTextIndex(text, shown.length, maxStep);
    shownRef.current = text.slice(0, end);
    setVisible(shownRef.current);
    if (end < text.length) {
      timerRef.current = window.setTimeout(() => runRef.current(), paceMs);
    }
  };

  useEffect(() => {
    const shown = shownRef.current;
    if (!isStreaming || !fullText.startsWith(shown) || fullText.length < shown.length) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      shownRef.current = fullText;
      setVisible(fullText);
      return;
    }
    if (fullText.length === shown.length || timerRef.current !== undefined) {
      return;
    }
    timerRef.current = window.setTimeout(() => runRef.current(), paceMs);
  }, [fullText, isStreaming, paceMs]);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return visible;
}
