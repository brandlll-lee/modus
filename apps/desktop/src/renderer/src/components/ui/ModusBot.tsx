import { type AnimationPlaybackControls, useAnimate, useReducedMotion } from "motion/react";
import { memo, useEffect } from "react";
import { cn } from "../../lib/cn";

/**
 * Animated Modus mascot — a chunky pixel desk-pet rebuilt as an SVG of <rect>
 * parts (eyes / body / 3 legs) from the brand PNG, then choreographed with
 * Motion à la Claude's mascot.
 *
 * Engineering notes:
 * - Transform-only animations (x / y / scale / rotate) → GPU-composited on the
 *   compositor thread, so the loop never competes with React renders or the
 *   streaming-text typewriter for main-thread budget.
 * - Each part is a <g> with `transform-box: fill-box` + an explicit
 *   `transform-origin` so scales/rotations pivot from the right spot
 *   (body squashes onto the floor, legs swing from the hip, eyes blink at center).
 * - Behaviour is a sequential async "personality loop": idle-breathe → maybe
 *   walk-in-place → maybe hop, with randomised pauses, so it feels alive instead
 *   of a fixed canned loop. Keyframes always return to rest, so states compose
 *   without drift.
 * - Respects `prefers-reduced-motion`: renders a static sprite, no loop.
 */

const PURPLE = "#863ff5";

type ModusBotProps = {
  className?: string;
  /** Run the animation loop. When false, the bot settles into a static rest pose. Defaults to true. */
  active?: boolean;
  /**
   * "Busy" cadence — continuous walk↔hop with tight beats, for the
   * "Working for Xs" indicator. When false, a calmer idle-led personality loop.
   */
  busy?: boolean;
};

export const ModusBot = memo(function ModusBot({
  className,
  active = true,
  busy = false,
}: ModusBotProps) {
  const [scope, animate] = useAnimate();
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (prefersReduced) {
      return;
    }

    if (!active) {
      // Settle to the clean rest pose — covers the working → done transition,
      // where the previous run may have been stopped mid-stride.
      animate("#mb-root", { y: 0, rotate: 0, scale: 1 }, { duration: 0.28, ease: "easeOut" });
      animate("#mb-eyes", { x: 0, scaleY: 1 }, { duration: 0.2, ease: "easeOut" });
      animate(
        "#mb-body",
        { x: 0, y: 0, scaleX: 1, scaleY: 1 },
        { duration: 0.28, ease: "easeOut" },
      );
      for (const id of ["#mb-legs", "#mb-leg-1", "#mb-leg-2", "#mb-leg-3"]) {
        animate(id, { y: 0 }, { duration: 0.2, ease: "easeOut" });
      }
      return;
    }

    let alive = true;
    const running = new Set<AnimationPlaybackControls>();
    const run = (controls: AnimationPlaybackControls): AnimationPlaybackControls => {
      running.add(controls);
      void controls.finished.finally(() => running.delete(controls)).catch(() => {});
      return controls;
    };
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    /* ── Ambient idle ─────────────────────────────────────────────── */
    async function blink() {
      await run(animate("#mb-eyes", { scaleY: [1, 0.12, 1] }, { duration: 0.16, ease: "easeOut" }))
        .finished;
    }
    async function lookAround() {
      const dir = Math.random() < 0.5 ? -2.5 : 2.5;
      await run(
        animate(
          "#mb-eyes",
          { x: [0, dir, dir, 0] },
          { duration: 1.3, ease: "easeInOut", times: [0, 0.22, 0.7, 1] },
        ),
      ).finished;
    }
    async function idle() {
      const breaths = 1 + Math.floor(Math.random() * 2);
      const breathing = run(
        animate(
          "#mb-body",
          { scaleY: [1, 1.045, 1], scaleX: [1, 0.99, 1] },
          { duration: 2.1, ease: "easeInOut", repeat: breaths - 1 },
        ),
      );
      if (Math.random() < 0.7) {
        await sleep(350);
        await blink();
        if (Math.random() < 0.45) {
          await sleep(150);
          await blink();
        }
      }
      if (alive && Math.random() < 0.45) {
        await lookAround();
      }
      await breathing.finished;
    }

    /* ── Walk in place (3 legs alternate, body bobs, slight lean) ──── */
    async function walk() {
      const step = 0.34;
      const reps = 3;
      const lift = { y: [0, -2.6, 0] };
      const legOpts = { duration: step, repeat: reps, ease: "easeInOut" as const };
      run(animate("#mb-leg-1", lift, legOpts));
      run(animate("#mb-leg-2", lift, { ...legOpts, delay: step / 3 }));
      const last = run(animate("#mb-leg-3", lift, { ...legOpts, delay: (step * 2) / 3 }));
      run(
        animate(
          "#mb-body",
          { y: [0, -0.9, 0] },
          { duration: step / 2, repeat: reps * 2, ease: "easeInOut" },
        ),
      );
      run(
        animate(
          "#mb-root",
          { rotate: [0, 1.6, -1.6, 0] },
          { duration: step * 1.5, repeat: 1, ease: "easeInOut" },
        ),
      );
      await last.finished;
    }

    /* ── Hop: crouch → parabolic launch (stretch) → land squash ───── */
    async function hop() {
      // Crouch — gather momentum.
      await Promise.all([
        run(
          animate(
            "#mb-body",
            { scaleY: 0.82, scaleX: 1.08, y: 2 },
            { duration: 0.12, ease: "easeIn" },
          ),
        ).finished,
        run(animate("#mb-legs", { y: 2 }, { duration: 0.12, ease: "easeIn" })).finished,
      ]);
      // Launch up + stretch (sine-out feel = gravity decel on the way up).
      await Promise.all([
        run(animate("#mb-root", { y: -15 }, { duration: 0.3, ease: "circOut" })).finished,
        run(
          animate(
            "#mb-body",
            { scaleY: 1.12, scaleX: 0.93, y: 0 },
            { duration: 0.2, ease: "easeOut" },
          ),
        ).finished,
        run(animate("#mb-legs", { y: -1.5 }, { duration: 0.2, ease: "easeOut" })).finished,
      ]);
      // Fall (power-in feel = gravity accel on the way down).
      await run(animate("#mb-root", { y: 0 }, { duration: 0.24, ease: "circIn" })).finished;
      // Land squash + overshoot recover.
      await Promise.all([
        run(
          animate(
            "#mb-body",
            { scaleY: [0.78, 1.06, 1], scaleX: [1.12, 0.97, 1], y: [2, 0, 0] },
            { duration: 0.34, ease: "easeOut", times: [0, 0.55, 1] },
          ),
        ).finished,
        run(animate("#mb-legs", { y: [1.5, 0] }, { duration: 0.22, ease: "easeOut" })).finished,
      ]);
    }

    /* ── Personality loop ─────────────────────────────────────────── */
    (async () => {
      run(animate("#mb-root", { scale: [0.92, 1] }, { duration: 0.45, ease: "backOut" }));
      while (alive) {
        if (busy) {
          // Working cadence — always moving: stride, beat, hop, beat.
          await walk();
          if (!alive) break;
          await sleep(140);
          await hop();
          if (!alive) break;
          await sleep(220);
        } else {
          await idle();
          if (!alive) break;
          const roll = Math.random();
          if (roll < 0.45) {
            await walk();
          } else if (roll < 0.78) {
            await hop();
          }
          if (!alive) break;
          await sleep(500 + Math.random() * 1300);
        }
      }
    })();

    return () => {
      alive = false;
      for (const controls of running) {
        controls.stop();
      }
    };
  }, [animate, prefersReduced, active, busy]);

  return (
    <svg
      aria-label="Modus"
      className={cn("overflow-visible", className)}
      ref={scope}
      role="img"
      shapeRendering="crispEdges"
      style={{ color: PURPLE }}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        id="mb-root"
        fill="currentColor"
        style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
      >
        <g id="mb-eyes" style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}>
          <rect x="18" y="11" width="8" height="19" />
          <rect x="37" y="11" width="11" height="19" />
        </g>
        <g id="mb-body" style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
          <rect x="7" y="30" width="52" height="11" />
        </g>
        <g id="mb-legs">
          <g id="mb-leg-1" style={{ transformBox: "fill-box", transformOrigin: "50% 0%" }}>
            <rect x="7" y="41" width="11" height="10" />
            <rect x="7" y="51" width="10" height="1" />
          </g>
          <g id="mb-leg-2" style={{ transformBox: "fill-box", transformOrigin: "50% 0%" }}>
            <rect x="26" y="41" width="11" height="10" />
            <rect x="27" y="51" width="9" height="1" />
          </g>
          <g id="mb-leg-3" style={{ transformBox: "fill-box", transformOrigin: "50% 0%" }}>
            <rect x="48" y="41" width="11" height="10" />
            <rect x="48" y="51" width="10" height="1" />
          </g>
        </g>
      </g>
    </svg>
  );
});
