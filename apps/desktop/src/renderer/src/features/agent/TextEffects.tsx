import { m, useAnimationFrame, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";

type ShinyTextProps = {
  children: string;
  className?: string;
  disabled?: boolean;
  speed?: number;
  delay?: number;
};

export function ShinyText({
  children,
  className,
  delay = 0.45,
  disabled = false,
  speed = 2.2,
}: ShinyTextProps) {
  const progress = useMotionValue(0);
  const elapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const animationDuration = speed * 1000;
  const delayDuration = delay * 1000;
  const backgroundPosition = useTransform(progress, (value) => `${150 - value * 2}% center`);

  useAnimationFrame((time) => {
    if (disabled) {
      lastTimeRef.current = null;
      return;
    }

    if (lastTimeRef.current === null) {
      lastTimeRef.current = time;
      return;
    }

    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;
    elapsedRef.current += delta;

    const cycleDuration = animationDuration + delayDuration;
    const cycleTime = elapsedRef.current % cycleDuration;
    progress.set(cycleTime < animationDuration ? (cycleTime / animationDuration) * 100 : 100);
  });

  useEffect(() => {
    elapsedRef.current = 0;
    lastTimeRef.current = null;
    progress.set(0);
  }, [progress]);

  return (
    <m.span
      className={cn("inline-block text-fg-subtle", className)}
      style={{
        backgroundClip: "text",
        backgroundImage:
          "linear-gradient(120deg, var(--color-fg-faint) 0%, var(--color-fg-subtle) 35%, var(--color-fg) 50%, var(--color-fg-subtle) 65%, var(--color-fg-faint) 100%)",
        backgroundPosition,
        backgroundSize: "200% auto",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }}
    >
      {children}
    </m.span>
  );
}
