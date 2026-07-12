import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import type { MermaidConfig } from "@streamdown/mermaid";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { memo, useContext, useLayoutEffect, useMemo } from "react";
import remarkBreaks from "remark-breaks";
import type { BlockProps, Components, StreamdownProps } from "streamdown";
import { Block, defaultRemarkPlugins, Streamdown, StreamdownContext } from "streamdown";
import { cn } from "../../lib/cn";
import { type ThemeMode, useTheme } from "../../lib/theme";
import { createStreamingTailAnimation } from "./streamingTailAnimation";

type MarkdownMessageRendererProps = {
  className?: string | undefined;
  content: string;
  streaming?: boolean;
};

/* ── Shiki dual theme [light, dark] ───────────────────────────────────────
 * Streamdown stamps each token with inline CSS vars: `--sdm-c` (the light
 * theme colour) and `--shiki-dark` (the dark theme colour). Its Tailwind
 * `text-[var(--sdm-c)]` / `dark:text-[var(--shiki-dark)]` utilities are NOT in
 * Modus's bundle (we don't compile Streamdown's classes) AND its `dark:`
 * follows OS prefers-color-scheme, not our `data-theme`. So we ship ONE highlight
 * pass with both themes and switch the token colours ourselves in app.css,
 * keyed to `:root[data-theme]`. Stable module constants → memo-friendly, and
 * Dark+ can use VS Code's bundled dark-plus without changing the original Dark. */
const codeDark = createCodePlugin({
  themes: ["github-light", "one-dark-pro"],
});
const codeDarkPlus = createCodePlugin({
  themes: ["github-light", "dark-plus"],
});

/* Math/CJK plugins are theme-agnostic — kept as stable module constants.
 * singleDollarTextMath: true renders inline `$...$` (what LLMs emit for math),
 * matching ChatGPT/Claude. Block `$$...$$` works regardless. Tradeoff: bare
 * currency like "$5" can be misread as math, but for a coding/math agent
 * correct formula rendering is the right call. errorColor stays muted so an
 * invalid expression degrades quietly in both themes. */
const math = createMathPlugin({
  errorColor: "#8a8a87",
  singleDollarTextMath: true,
});

/* ── Mermaid theme — mermaid cannot resolve CSS var(), so we pass computed
 * token values from the active Modus theme. ───────────────────────────────── */
function buildMermaidConfig(theme: ThemeMode): MermaidConfig {
  const rootStyle = getComputedStyle(document.documentElement);
  const fontFamily =
    rootStyle.getPropertyValue("--font-sans").trim() ||
    '"Inter Variable", "Inter", system-ui, sans-serif';
  const token = (name: string, fallback: string): string =>
    rootStyle.getPropertyValue(name).trim() || fallback;

  if (theme === "light") {
    return {
      fontFamily,
      securityLevel: "strict",
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        background: "transparent",
        darkMode: false,
        fontFamily,
        lineColor: token("--color-fg-faint", "#9a9a9a"),
        mainBkg: token("--color-surface", "#ffffff"),
        nodeBorder: token("--color-hairline-strong", "rgba(0, 0, 0, 0.18)"),
        primaryBorderColor: token("--color-hairline-strong", "rgba(0, 0, 0, 0.18)"),
        primaryColor: token("--color-panel", "#f8f8f8"),
        primaryTextColor: token("--color-fg", "#242424"),
        secondaryColor: token("--color-surface", "#ffffff"),
        tertiaryColor: token("--color-panel", "#f8f8f8"),
        textColor: token("--color-fg", "#242424"),
      },
    } satisfies MermaidConfig;
  }
  return {
    fontFamily,
    securityLevel: "strict",
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      background: "transparent",
      darkMode: true,
      fontFamily,
      lineColor: token("--color-fg-faint", "#5a5a5d"),
      mainBkg: token("--color-surface", "#1c1c1d"),
      nodeBorder: token("--color-hairline-strong", "rgba(255, 255, 255, 0.065)"),
      primaryBorderColor: token("--color-hairline-strong", "rgba(255, 255, 255, 0.065)"),
      primaryColor: token("--color-elevated", "#232325"),
      primaryTextColor: token("--color-fg", "#e4e4e3"),
      secondaryColor: token("--color-surface", "#1c1c1d"),
      tertiaryColor: token("--color-panel", "#161617"),
      textColor: token("--color-fg", "#e4e4e3"),
    },
  } satisfies MermaidConfig;
}

const LINK_SAFETY: NonNullable<StreamdownProps["linkSafety"]> = { enabled: false };

/* Render a single `\n` as a hard line break (GFM soft breaks otherwise collapse
 * lines into one paragraph). Stable module-level reference to preserve memo. */
const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkBreaks];

const StreamingBlock = memo(function StreamingBlock({
  content,
  rehypePlugins,
  ...props
}: BlockProps) {
  const { isAnimating } = useContext(StreamdownContext);
  const tailAnimation = useMemo(createStreamingTailAnimation, []);
  const tailPlugin = useMemo(
    () => tailAnimation.plugin(content, isAnimating),
    [content, isAnimating, tailAnimation],
  );
  const plugins = useMemo<NonNullable<BlockProps["rehypePlugins"]>>(
    () => [...(rehypePlugins ?? []), tailPlugin],
    [rehypePlugins, tailPlugin],
  );
  useLayoutEffect(() => tailAnimation.commit(content), [content, tailAnimation]);
  return <Block content={content} rehypePlugins={plugins} {...props} />;
});

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
  className,
  content,
  streaming = false,
}: MarkdownMessageRendererProps) {
  const [theme] = useTheme();

  // Rebuild syntax-highlight + diagram plugins only when the theme flips
  // (rare, deliberate) — stable across streamed frames so Streamdown's memo
  // holds and the typewriter stays smooth.
  const mermaidConfig = useMemo(() => buildMermaidConfig(theme), [theme]);
  const codePlugin = theme === "dark-plus" ? codeDarkPlus : codeDark;
  const plugins = useMemo(
    () =>
      ({
        cjk,
        code: codePlugin,
        math,
        mermaid: createMermaidPlugin({ config: mermaidConfig }),
      }) satisfies NonNullable<StreamdownProps["plugins"]>,
    [codePlugin, mermaidConfig],
  );
  const mermaidProp = useMemo<NonNullable<StreamdownProps["mermaid"]>>(
    () => ({ config: mermaidConfig }),
    [mermaidConfig],
  );

  return (
    <Streamdown
      BlockComponent={StreamingBlock}
      className={cn("modus-markdown text-fg", className)}
      components={components}
      controls={controls}
      dir="auto"
      isAnimating={streaming}
      linkSafety={LINK_SAFETY}
      lineNumbers={false}
      mermaid={mermaidProp}
      mode="streaming"
      normalizeHtmlIndentation
      parseIncompleteMarkdown
      plugins={plugins}
      remarkPlugins={REMARK_PLUGINS}
      translations={translations}
    >
      {content}
    </Streamdown>
  );
}
