import { cn } from "../../lib/cn";

/**
 * Counter-rotating dot-grid loader for subagent rows. Uses `currentColor` so
 * light/dark themes follow the surrounding text color — no hardcoded white.
 */
export function VortexMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("vortex-mark text-fg", className)}
      role="img"
      viewBox="0 0 56 56"
    >
      <title>Vortex</title>
      <defs>
        <circle id="vortex-b" opacity="0.08" r="2.4" fill="currentColor" />
        <circle id="vortex-l" r="3.1" />
      </defs>
      <style>{`
        .vortex-mark .vl {
          fill: currentColor;
          opacity: 0;
          animation: vortex-mark-k 2400ms linear infinite both;
        }
        @keyframes vortex-mark-k {
          0% { opacity: 0; }
          4% { opacity: 0.85; }
          26% { opacity: 0.08; }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vortex-mark .vl { animation: none; opacity: 0.4; }
        }
        .vortex-mark .d00, .vortex-mark .d11, .vortex-mark .d22 { animation-delay: 0ms; }
        .vortex-mark .d01 { animation-delay: 150ms; }
        .vortex-mark .d02, .vortex-mark .d21 { animation-delay: 300ms; }
        .vortex-mark .d03 { animation-delay: 450ms; }
        .vortex-mark .d04, .vortex-mark .d31 { animation-delay: 600ms; }
        .vortex-mark .d10 { animation-delay: 2250ms; }
        .vortex-mark .d12, .vortex-mark .d20 { animation-delay: 2100ms; }
        .vortex-mark .d13, .vortex-mark .d40 { animation-delay: 1800ms; }
        .vortex-mark .d14 { animation-delay: 750ms; }
        .vortex-mark .d23, .vortex-mark .d42 { animation-delay: 1500ms; }
        .vortex-mark .d24, .vortex-mark .d32 { animation-delay: 900ms; }
        .vortex-mark .d30 { animation-delay: 1950ms; }
        .vortex-mark .d33, .vortex-mark .d44 { animation-delay: 1200ms; }
        .vortex-mark .d34 { animation-delay: 1050ms; }
        .vortex-mark .d41 { animation-delay: 1650ms; }
        .vortex-mark .d43 { animation-delay: 1350ms; }
      `}</style>
      {[6, 17, 28, 39, 50].flatMap((y) =>
        [6, 17, 28, 39, 50].map((x) => (
          <use href="#vortex-b" key={`b-${x}-${y}`} x={x} y={y} />
        )),
      )}
      {(
        [
          ["d00", 6, 6],
          ["d01", 17, 6],
          ["d02", 28, 6],
          ["d03", 39, 6],
          ["d04", 50, 6],
          ["d10", 6, 17],
          ["d11", 17, 17],
          ["d12", 28, 17],
          ["d13", 39, 17],
          ["d14", 50, 17],
          ["d20", 6, 28],
          ["d21", 17, 28],
          ["d22", 28, 28],
          ["d23", 39, 28],
          ["d24", 50, 28],
          ["d30", 6, 39],
          ["d31", 17, 39],
          ["d32", 28, 39],
          ["d33", 39, 39],
          ["d34", 50, 39],
          ["d40", 6, 50],
          ["d41", 17, 50],
          ["d42", 28, 50],
          ["d43", 39, 50],
          ["d44", 50, 50],
        ] as const
      ).map(([delay, x, y]) => (
        <use className={`vl ${delay}`} href="#vortex-l" key={delay} x={x} y={y} />
      ))}
    </svg>
  );
}
