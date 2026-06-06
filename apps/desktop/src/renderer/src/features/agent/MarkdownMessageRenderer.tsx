import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import type { MermaidConfig } from "@streamdown/mermaid";
import type { Components, StreamdownProps } from "streamdown";
import { Streamdown } from "streamdown";
import { cn } from "../../lib/cn";

type MarkdownMessageRendererProps = {
  content: string;
  streaming?: boolean;
};

const code = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

const math = createMathPlugin({
  errorColor: "var(--color-fg-subtle)",
  singleDollarTextMath: false,
});

const mermaidConfig = {
  fontFamily: "var(--font-sans)",
  securityLevel: "strict",
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    background: "var(--color-canvas)",
    darkMode: true,
    fontFamily: "var(--font-sans)",
    lineColor: "var(--color-fg-faint)",
    mainBkg: "var(--color-surface)",
    nodeBorder: "var(--color-hairline-strong)",
    primaryBorderColor: "var(--color-hairline-strong)",
    primaryColor: "var(--color-surface)",
    primaryTextColor: "var(--color-fg)",
    secondaryColor: "var(--color-elevated)",
    tertiaryColor: "var(--color-panel)",
    textColor: "var(--color-fg)",
  },
} satisfies MermaidConfig;

const mermaid = createMermaidPlugin({
  config: mermaidConfig,
});

const plugins = { cjk, code, math, mermaid } satisfies NonNullable<StreamdownProps["plugins"]>;

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

export default function MarkdownMessageRenderer({
  content,
  streaming = false,
}: MarkdownMessageRendererProps) {
  return (
    <Streamdown
      animated={streaming ? { animation: "fadeIn", duration: 90, sep: "word", stagger: 14 } : false}
      caret="block"
      className="modus-markdown text-fg"
      components={components}
      controls={controls}
      dir="auto"
      isAnimating={streaming}
      linkSafety={{ enabled: false }}
      mermaid={{ config: mermaidConfig }}
      mode={streaming ? "streaming" : "static"}
      normalizeHtmlIndentation
      parseIncompleteMarkdown={streaming}
      plugins={plugins}
      translations={translations}
    >
      {content}
    </Streamdown>
  );
}
