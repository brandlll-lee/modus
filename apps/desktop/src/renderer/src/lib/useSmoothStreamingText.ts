import { useEffect, useRef, useState } from "react";

/**
 * Client-side typewriter / jitter-buffer for streamed text.
 *
 * Why: providers stream in bursty chunks, so feeding raw deltas to the renderer
 * makes whole batches "pop in" at once instead of revealing smoothly like
 * ChatGPT/Codex. This hook decouples display from network cadence: it holds the
 * full accumulated text and reveals a steadily-growing prefix on a rAF loop at
 * an adaptive rate, snapping to grapheme boundaries (CJK/emoji safe) via
 * Intl.Segmenter. When streaming ends it flushes the remainder instantly.
 *
 * Pattern mirrors coder/coder#22503 and onyx#10093. Intl.Segmenter is Baseline
 * 2024 and fully supported in Electron's Chromium.
 */

/*
 * Pacing knobs. Tuned for a slow, silky reveal that never bursts.
 *
 * The earlier values (90–480 cps, 64-grapheme frame cap) revealed large chunks
 * per frame during catch-up; with Streamdown's per-word blurIn fade that reads
 * as a brief "flash" when many words mount in one frame. We slow the steady
 * pace and — most importantly — drop the frame cap so a single frame can only
 * ever reveal a handful of graphemes, turning catch-up into a smooth ramp
 * instead of a jump. Smaller per-frame slices also mean smaller Streamdown
 * re-parse deltas, so this is cheaper per frame, not more expensive.
 *
 * Calibrated against the 2026 references this hook is modelled on:
 * coder/coder#22503 (72–420 cps, 48 frame cap), onyx#10093 (~120 cps,
 * 2 chars/frame), AI SDK v5 / Upstash (~200 cps "readable, not too slow").
 */
const MIN_CPS = 48; // chars/sec when nearly caught up — unhurried, readable
const MAX_CPS = 300; // chars/sec ceiling when far behind — drains bursts calmly
const PRESSURE_SCALE = 420; // backlog (chars) that maps to full speed — gentle ramp
const MAX_LAG = 480; // hard cap: never lag more than this many chars
const FRAME_CAP = 12; // max graphemes revealed in a single frame — kills the burst/flash
const MAX_DT = 0.05; // clamp frame delta (s) to avoid jumps after tab blur

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Advance `count` grapheme clusters from `fromIndex`, returning the new code-unit index. */
function advanceGraphemes(text: string, fromIndex: number, count: number): number {
  if (count <= 0 || fromIndex >= text.length) {
    return Math.min(fromIndex, text.length);
  }
  if (!segmenter) {
    let index = fromIndex;
    let revealed = 0;
    while (index < text.length && revealed < count) {
      const codePoint = text.codePointAt(index) ?? 0;
      index += codePoint > 0xffff ? 2 : 1;
      revealed += 1;
    }
    return index;
  }
  // Bound the work per frame: a window large enough to hold `count` graphemes.
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

export function useSmoothStreamingText(fullText: string, isStreaming: boolean): string {
  const [visible, setVisible] = useState(isStreaming ? "" : fullText);

  const fullRef = useRef(fullText);
  fullRef.current = fullText;
  const indexRef = useRef(isStreaming ? 0 : fullText.length);
  const budgetRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      // Flush: reveal everything immediately when the stream ends.
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      lastTsRef.current = null;
      budgetRef.current = 0;
      indexRef.current = fullRef.current.length;
      setVisible(fullRef.current);
      return;
    }

    const tick = (timestamp: number): void => {
      const full = fullRef.current;
      const total = full.length;
      if (lastTsRef.current === null) {
        lastTsRef.current = timestamp;
      }
      const dt = Math.min(MAX_DT, (timestamp - lastTsRef.current) / 1000);
      lastTsRef.current = timestamp;

      let index = indexRef.current;
      if (index > total) {
        // Content was reset/replaced with something shorter — restart.
        index = 0;
        budgetRef.current = 0;
      }

      const backlog = total - index;
      if (backlog > 0) {
        const pressure = Math.min(1, backlog / PRESSURE_SCALE);
        const cps = MIN_CPS + (MAX_CPS - MIN_CPS) * pressure;
        budgetRef.current += cps * dt;

        let reveal = Math.floor(budgetRef.current);
        if (reveal >= 1) {
          budgetRef.current -= reveal;
        } else {
          reveal = 0;
        }
        // Catch up hard if we have fallen too far behind.
        if (backlog - reveal > MAX_LAG) {
          reveal = backlog - MAX_LAG;
        }
        reveal = Math.min(reveal, FRAME_CAP, backlog);

        if (reveal > 0) {
          index = advanceGraphemes(full, index, reveal);
          indexRef.current = index;
          setVisible(full.slice(0, index));
        }
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      lastTsRef.current = null;
    };
  }, [isStreaming]);

  return visible;
}
