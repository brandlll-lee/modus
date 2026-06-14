import { useEffect, useState } from "react";
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * Shared syntax highlighter for the inline diff cards (edit/write tool views).
 *
 * Uses Shiki's pure-JS regex engine (no WASM) so it loads cleanly in the
 * Electron renderer and stays cheap to call repeatedly while a file streams in.
 * One lazily-created singleton serves every card; the two themes mirror the
 * Markdown renderer (`github-light` / `one-dark-pro`) so code reads the same
 * across the app. Grammars are loaded on demand per language and cached.
 */

const THEME_BY_MODE = {
  light: "github-light",
  dark: "one-dark-pro",
} as const;

export type CodeThemeMode = keyof typeof THEME_BY_MODE;

/** Map a file path to a Shiki language id, or undefined for plain text. */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  xml: "xml",
  swift: "swift",
};

export function languageForPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_LANGUAGE[ext] : undefined;
}

type LanguageLoaders = Record<string, () => Promise<{ default: unknown }>>;

// Shiki ships every grammar/theme as its own ESM module; importing them through
// these maps lets Vite code-split each one and lets us load a language only the
// first time a card needs it.
const LANGUAGE_LOADERS = import.meta.glob("../../../../node_modules/shiki/dist/langs/*.mjs");
const THEME_LOADERS = import.meta.glob("../../../../node_modules/shiki/dist/themes/*.mjs");

function loaderFor(loaders: Record<string, () => Promise<unknown>>, name: string) {
  const key = Object.keys(loaders).find((path) => path.endsWith(`/${name}.mjs`));
  return key ? loaders[key] : undefined;
}

let corePromise: Promise<HighlighterCore> | undefined;
let core: HighlighterCore | undefined;
const loadedLanguages = new Set<string>();
const loadingLanguages = new Map<string, Promise<void>>();

function ensureCore(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = (async () => {
      const themeNames = Object.values(THEME_BY_MODE);
      const themes = await Promise.all(
        themeNames.map(async (name) => {
          const load = loaderFor(THEME_LOADERS as LanguageLoaders, name);
          if (!load) {
            throw new Error(`Shiki theme not found: ${name}`);
          }
          return ((await load()) as { default: unknown }).default;
        }),
      );
      const created = await createHighlighterCore({
        themes: themes as NonNullable<Parameters<typeof createHighlighterCore>[0]["themes"]>,
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
      core = created;
      return created;
    })();
  }
  return corePromise;
}

/** Load a language grammar into the singleton, once. Resolves true if usable. */
async function ensureLanguage(lang: string): Promise<boolean> {
  if (loadedLanguages.has(lang)) {
    return true;
  }
  const existing = loadingLanguages.get(lang);
  if (existing) {
    await existing;
    return loadedLanguages.has(lang);
  }
  const load = loaderFor(LANGUAGE_LOADERS as LanguageLoaders, lang);
  if (!load) {
    return false;
  }
  const task = (async () => {
    const instance = await ensureCore();
    const mod = await load();
    await instance.loadLanguage(
      (mod as { default: Parameters<HighlighterCore["loadLanguage"]>[0] }).default,
    );
    loadedLanguages.add(lang);
  })();
  loadingLanguages.set(lang, task);
  await task;
  loadingLanguages.delete(lang);
  return loadedLanguages.has(lang);
}

/**
 * Tokenize `code` for a language + theme. Returns one token array per line, or
 * undefined when the highlighter/grammar isn't ready yet (callers fall back to
 * plain text and re-render once `useCodeHighlighter` reports readiness).
 */
export function highlightToLines(
  code: string,
  lang: string | undefined,
  mode: CodeThemeMode,
): ThemedToken[][] | undefined {
  if (!core || !lang || !loadedLanguages.has(lang)) {
    return undefined;
  }
  return core.codeToTokens(code, { lang, theme: THEME_BY_MODE[mode] }).tokens;
}

/**
 * Readiness signal for a given language. Triggers the singleton + grammar load
 * and re-renders the caller once tokenization becomes possible. Returns a
 * monotonically increasing token so memoized highlight passes recompute.
 */
export function useCodeHighlighter(lang: string | undefined): number {
  const [ready, setReady] = useState(0);
  useEffect(() => {
    if (!lang) {
      return;
    }
    let alive = true;
    void ensureLanguage(lang).then((ok) => {
      if (alive && ok) {
        setReady((value) => value + 1);
      }
    });
    return () => {
      alive = false;
    };
  }, [lang]);
  return ready;
}
