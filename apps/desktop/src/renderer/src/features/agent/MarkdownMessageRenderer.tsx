import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import type { MermaidConfig } from "@streamdown/mermaid";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { useMemo } from "react";
import remarkBreaks from "remark-breaks";
import type { Components, StreamdownProps } from "streamdown";
import { defaultRemarkPlugins, Streamdown } from "streamdown";
import { cn } from "../../lib/cn";
import { type ThemeMode, useTheme } from "../../lib/theme";

type MarkdownMessageRendererProps = {
  content: string;
  streaming?: boolean;
};

const FONT_STACK = '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif';

/* ── Shiki dual theme [light, dark] ───────────────────────────────────────
 * Streamdown stamps each token with inline CSS vars: `--sdm-c` (the light
 * theme colour) and `--shiki-dark` (the dark theme colour). Its Tailwind
 * `text-[var(--sdm-c)]` / `dark:text-[var(--shiki-dark)]` utilities are NOT in
 * Modus's bundle (we don't compile Streamdown's classes) AND its `dark:`
 * follows OS prefers-color-scheme, not our `data-theme`. So we ship ONE highlight
 * pass with both themes and switch the token colours ourselves in app.css,
 * keyed to `:root[data-theme]`. Stable module constant → memo-friendly, no
 * re-highlight on theme toggle. */
const code = createCodePlugin({
  themes: ["github-light", "one-dark-pro"],
});

/* Math/CJK plugins are theme-agnostic — kept as stable module constants. */
const math = createMathPlugin({
  errorColor: "#8a8a87",
  singleDollarTextMath: false,
});

/* ── Mermaid theme — literal hex values (mermaid cannot resolve CSS var()), so
 * we mirror the Modus dark/light tokens per mode. ─────────────────────────── */
function buildMermaidConfig(theme: ThemeMode): MermaidConfig {
  if (theme === "light") {
    return {
      fontFamily: FONT_STACK,
      securityLevel: "strict",
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        background: "transparent",
        darkMode: false,
        fontFamily: FONT_STACK,
        lineColor: "#9a9ca2",
        mainBkg: "#ffffff",
        nodeBorder: "rgba(0, 0, 0, 0.14)",
        primaryBorderColor: "rgba(0, 0, 0, 0.14)",
        primaryColor: "#f1f1f0",
        primaryTextColor: "#1b1b1d",
        secondaryColor: "#f7f7f6",
        tertiaryColor: "#ffffff",
        textColor: "#1b1b1d",
      },
    } satisfies MermaidConfig;
  }
  return {
    fontFamily: FONT_STACK,
    securityLevel: "strict",
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      background: "transparent",
      darkMode: true,
      fontFamily: FONT_STACK,
      lineColor: "#5a5a5d",
      mainBkg: "#1c1c1d",
      nodeBorder: "rgba(255, 255, 255, 0.065)",
      primaryBorderColor: "rgba(255, 255, 255, 0.065)",
      primaryColor: "#232325",
      primaryTextColor: "#e4e4e3",
      secondaryColor: "#1c1c1d",
      tertiaryColor: "#161617",
      textColor: "#e4e4e3",
    },
  } satisfies MermaidConfig;
}

/* ── Stable references ─────────────────────────────────────────────────
 * Streamdown's React.memo watches `animated`, `linkSafety`, `mode`, `plugins`,
 * `className`, etc. Passing fresh inline objects on every render busts that memo
 * and forces a full re-parse/re-render of ALL blocks per streamed frame, which
 * (a) re-mounts word spans → the fade-in restarts out of order, and
 * (b) saturates the main thread → text + tool spinner stutter.
 * Hoisting these to module-level constants keeps the references stable so only
 * the last streaming block re-renders incrementally.
 * Refs: https://streamdown.ai/docs/memoization, vercel/streamdown#435, deer-flow#2824
 *
 * Animation tuning: per Streamdown's animation guide, fast models that dump many
 * tokens per commit look smoother with `blurIn` + a longer duration (200-300ms),
 * which masks batch arrivals far better than a short fadeIn. Especially relevant
 * for CJK content where `sep: "word"` splits coarsely.
 *
 * stagger MUST stay 0: Streamdown 2.5's `stagger` (default 40ms) has no
 * inter-block coordination, so sibling blocks/lines animate concurrently and
 * the reveal looks out of order (vercel/streamdown#482, #437 — open). 0 is the
 * official workaround. Smooth pacing is instead handled upstream by the
 * client-side typewriter (useSmoothStreamingText). */
const STREAMING_ANIMATION: NonNullable<StreamdownProps["animated"]> = {
  animation: "blurIn",
  duration: 220,
  easing: "ease-out",
  sep: "word",
  stagger: 0,
};

const LINK_SAFETY: NonNullable<StreamdownProps["linkSafety"]> = { enabled: false };

/* Render a single `\n` as a hard line break (GFM soft breaks otherwise collapse
 * lines into one paragraph). Stable module-level reference to preserve memo. */
const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkBreaks];

/* ── Controls ──────────────────────────────────────────────────────── */
const controls = {
  code: {
    copy: true,
    download: false,
  },
  mermaid: {
    copy: true,
    download: false,
    fullscreen: true,
    panZoom: true,
  },
  table: {
    copy: true,
    download: false,
    fullscreen: false,
  },
} satisfies NonNullable<StreamdownProps["controls"]>;

const translations = {
  copied: "Copied",
  copyCode: "Copy code",
  copyLink: "Copy link",
  copyTable: "Copy table",
  openExternalLink: "Open external link?",
  openLink: "Open link",
} satisfies Partial<NonNullable<StreamdownProps["translations"]>>;

/* ── Custom components ─────────────────────────────────────────────── */
const components: Components = {
  a({ children, href, node: _node, ...props }) {
    return (
      <a href={href} rel="noreferrer" target="_blank" {...props}>
        {children}
      </a>
    );
  },
  inlineCode({ children, className, node: _node, ...props }) {
    return (
      <code className={cn("modus-markdown-inline-code", className)} {...props}>
        {children}
      </code>
    );
  },
};

/* ── Main renderer ─────────────────────────────────────────────────── */
export default function MarkdownMessageRenderer({
  content,
  streaming = false,
}: MarkdownMessageRendererProps) {
  const [theme] = useTheme();

  // Rebuild syntax-highlight + diagram plugins only when the theme flips
  // (rare, deliberate) — stable across streamed frames so Streamdown's memo
  // holds and the typewriter stays smooth.
  const mermaidConfig = useMemo(() => buildMermaidConfig(theme), [theme]);
  const plugins = useMemo(
    () =>
      ({
        cjk,
        code,
        math,
        mermaid: createMermaidPlugin({ config: mermaidConfig }),
      }) satisfies NonNullable<StreamdownProps["plugins"]>,
    [mermaidConfig],
  );
  const mermaidProp = useMemo<NonNullable<StreamdownProps["mermaid"]>>(
    () => ({ config: mermaidConfig }),
    [mermaidConfig],
  );

  return (
    <Streamdown
      animated={streaming ? STREAMING_ANIMATION : false}
      caret="block"
      className="modus-markdown text-fg"
      components={components}
      controls={controls}
      dir="auto"
      isAnimating={streaming}
      linkSafety={LINK_SAFETY}
      mermaid={mermaidProp}
      mode={streaming ? "streaming" : "static"}
      normalizeHtmlIndentation
      parseIncompleteMarkdown={streaming}
      plugins={plugins}
      remarkPlugins={REMARK_PLUGINS}
      translations={translations}
    >
      {content}
    </Streamdown>
  );
}
