import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import type { MermaidConfig } from "@streamdown/mermaid";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { type ComponentProps, useContext, useMemo } from "react";
import remarkBreaks from "remark-breaks";
import type {
  AnimateOptions,
  Components,
  CustomRenderer,
  CustomRendererProps,
  MermaidErrorComponentProps,
  StreamdownProps,
} from "streamdown";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  StreamdownContext,
  useIsCodeFenceIncomplete,
} from "streamdown";
import { cn } from "../../lib/cn";
import { type ThemeMode, useTheme } from "../../lib/theme";
import { FileRefChip, MarkdownFileCode } from "./FileRefChip";
import { useMarkdownFileNav } from "./markdownFileNav";
import { normalizeMathDelimiters } from "./normalizeMathDelimiters";
import { Favicon } from "./toolIcons";
import { VisualToolCard } from "./VisualToolCard";
import { parseModusFileHref, rehypeWorkspaceFileLinks } from "./workspaceFileLinks";

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
 * remark-math only parses `$…$` / `$$…$$`. LLMs often emit `\(...\)` / `\[…\]`;
 * `normalizeMathDelimiters` aligns those to the dollar contract before parse.
 * singleDollarTextMath keeps inline `$…$` (ChatGPT/Claude-style). Tradeoff: bare
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
    '"Inter Variable", "Inter", "Noto Sans SC Variable", "Noto Sans SC", system-ui, sans-serif';
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
        clusterBkg: token("--color-panel", "#f8f8f8"),
        clusterBorder: token("--color-hairline-strong", "rgba(0, 0, 0, 0.09)"),
        darkMode: false,
        edgeLabelBackground: token("--color-surface", "#ffffff"),
        fontFamily,
        lineColor: token("--color-fg-faint", "#9a9a9a"),
        mainBkg: token("--color-surface", "#ffffff"),
        nodeBorder: token("--color-hairline-strong", "rgba(0, 0, 0, 0.09)"),
        primaryBorderColor: token("--color-hairline-strong", "rgba(0, 0, 0, 0.09)"),
        primaryColor: token("--color-surface", "#ffffff"),
        primaryTextColor: token("--color-fg", "#222222"),
        secondaryColor: token("--color-panel", "#f8f8f8"),
        tertiaryColor: token("--color-panel", "#f8f8f8"),
        textColor: token("--color-fg", "#222222"),
        titleColor: token("--color-fg-muted", "#666666"),
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
      clusterBkg: token("--color-panel", "#161617"),
      clusterBorder: token("--color-hairline-strong", "rgba(255, 255, 255, 0.065)"),
      darkMode: true,
      edgeLabelBackground: token("--color-surface", "#1c1c1d"),
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
      titleColor: token("--color-fg-muted", "#a0a0a0"),
    },
  } satisfies MermaidConfig;
}

const LINK_SAFETY: NonNullable<StreamdownProps["linkSafety"]> = { enabled: false };

const ANIMATED: AnimateOptions = {
  animation: "fadeIn",
  duration: 70,
  easing: "ease-out",
};

/* Render a single `\n` as a hard line break (GFM soft breaks otherwise collapse
 * lines into one paragraph). Stable module-level reference to preserve memo. */
const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkBreaks];

/**
 * raw → rewrite workspace path hrefs → sanitize.
 * Omit default harden: its indicator policy appends " [blocked]" after sanitize
 * strips `f:` drive-letter hrefs. Sanitize already gates link protocols.
 */
const { raw, sanitize } = defaultRehypePlugins;
if (!raw || !sanitize) throw new Error("Streamdown rehype defaults are incomplete.");
const REHYPE_PLUGINS = [raw, rehypeWorkspaceFileLinks, sanitize];

/**
 * Streamdown renders incomplete ```mermaid fences mid-stream; mermaid.parse
 * fails and the default UI is a red "Mermaid Error" flash. Authority signals:
 * isAnimating (whole turn streaming) + useIsCodeFenceIncomplete (this fence).
 * Quiet placeholder while open; muted copy only after the stream settles.
 */
function MermaidErrorSurface({ error }: MermaidErrorComponentProps) {
  const { isAnimating } = useContext(StreamdownContext);
  const fenceIncomplete = useIsCodeFenceIncomplete();
  if (isAnimating || fenceIncomplete) {
    return <div aria-hidden className="h-2" />;
  }
  return (
    <div className="px-3 py-2 font-mono text-fg-subtle text-xs">Diagram unavailable: {error}</div>
  );
}

/** Streamdown custom renderer: fenced html/svg grows via message.delta, not tool-arg dump. */
function VisualFenceRenderer({ code, isIncomplete, language }: CustomRendererProps) {
  return (
    <VisualToolCard
      args={{
        title: "Visual",
        kind: language === "svg" ? "svg" : "html",
        content: code,
      }}
      isComplete={!isIncomplete}
    />
  );
}

const VISUAL_FENCE_RENDERERS: CustomRenderer[] = [
  { language: ["html", "svg"], component: VisualFenceRenderer },
];

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
function InlineCodeWithFileNav({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<"code"> & { node?: unknown }) {
  const { cwd, onOpenFile } = useMarkdownFileNav();
  return (
    <MarkdownFileCode className={className} cwd={cwd} onOpenFile={onOpenFile} {...props}>
      {children}
    </MarkdownFileCode>
  );
}

function isHttpUrl(href: string | undefined): href is string {
  if (!href) {
    return false;
  }
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function MarkdownAnchor({
  children,
  href,
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const { onOpenFile } = useMarkdownFileNav();
  const path = parseModusFileHref(href);
  if (path) {
    if (onOpenFile) {
      return <FileRefChip onOpen={onOpenFile} path={path} />;
    }
    // Sentinel must never navigate; fall back to plain label without onOpenFile.
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    return <span className="font-medium text-sm">{name}</span>;
  }
  if (isHttpUrl(href)) {
    return (
      <a
        className="inline-flex max-w-full items-center gap-1 align-[-0.15em]"
        href={href}
        rel="noreferrer"
        target="_blank"
        {...props}
      >
        <Favicon url={href} />
        <span className="min-w-0 break-all">{children}</span>
      </a>
    );
  }
  return (
    <a href={href} rel="noreferrer" target="_blank" {...props}>
      {children}
    </a>
  );
}

const components: Components = {
  a: MarkdownAnchor,
  inlineCode: InlineCodeWithFileNav,
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
  // holds and the streaming animation stays smooth.
  const mermaidConfig = useMemo(() => buildMermaidConfig(theme), [theme]);
  const codePlugin = theme === "dark-plus" ? codeDarkPlus : codeDark;
  const plugins = useMemo(
    () =>
      ({
        cjk,
        code: codePlugin,
        math,
        mermaid: createMermaidPlugin({ config: mermaidConfig }),
        renderers: VISUAL_FENCE_RENDERERS,
      }) satisfies NonNullable<StreamdownProps["plugins"]>,
    [codePlugin, mermaidConfig],
  );
  const mermaidProp = useMemo<NonNullable<StreamdownProps["mermaid"]>>(
    () => ({ config: mermaidConfig, errorComponent: MermaidErrorSurface }),
    [mermaidConfig],
  );
  // Normalize once at the Streamdown boundary (after streaming slice), so
  // incomplete `\[` mid-chunk is left alone until the closing fence arrives.
  const markdown = useMemo(() => normalizeMathDelimiters(content), [content]);

  return (
    <Streamdown
      animated={ANIMATED}
      className={cn("modus-markdown", className)}
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
      rehypePlugins={REHYPE_PLUGINS}
      remarkPlugins={REMARK_PLUGINS}
      translations={translations}
    >
      {markdown}
    </Streamdown>
  );
}
