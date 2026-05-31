type StatusPillProps = {
  children: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

const tones: Record<NonNullable<StatusPillProps["tone"]>, string> = {
  neutral: "border-zinc-700 bg-zinc-900 text-zinc-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-300",
};

export function StatusPill({ children, tone = "neutral" }: StatusPillProps) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
