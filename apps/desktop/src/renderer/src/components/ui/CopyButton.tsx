import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

type CopyButtonProps = {
  /** The exact text placed on the clipboard (raw markdown for AI, raw text for user). */
  text: string;
  label?: string;
  className?: string;
};

/** Small icon button that copies `text` and flips to a check for ~1.6s. */
export function CopyButton({ text, label = "Copy", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleCopy = (): void => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  return (
    <button
      aria-label={label}
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-muted",
        className,
      )}
      onClick={handleCopy}
      title={copied ? "Copied" : label}
      type="button"
    >
      {copied ? <IconCheck size={13} stroke={1.9} /> : <IconCopy size={13} stroke={1.8} />}
    </button>
  );
}
