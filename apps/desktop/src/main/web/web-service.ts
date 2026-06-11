import TurndownService from "turndown";
import { extractHtmlTitle, htmlToText, parseMcpToolResponse } from "./web-content";

/**
 * Built-in web access for the agent: real-time search + page fetch.
 *
 * Search rides the public MCP endpoints that opencode also uses — Exa first,
 * Parallel as fallback — so it works with zero configuration. API keys
 * (EXA_API_KEY / PARALLEL_API_KEY) are honored when present for higher limits,
 * and MODUS_WEBSEARCH_PROVIDER pins a provider explicitly.
 */

const SEARCH_TIMEOUT_MS = 25_000;
const FETCH_DEFAULT_TIMEOUT_MS = 30_000;
const FETCH_MAX_TIMEOUT_MS = 120_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_RESULT_COUNT = 8;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

type SearchProvider = {
  name: string;
  url(): string;
  tool: string;
  arguments(query: string, numResults: number): Record<string, unknown>;
  headers(): Record<string, string>;
};

const exaProvider: SearchProvider = {
  name: "exa",
  url: () =>
    process.env.EXA_API_KEY
      ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
      : "https://mcp.exa.ai/mcp",
  tool: "web_search_exa",
  arguments: (query, numResults) => ({
    query,
    type: "auto",
    numResults,
    livecrawl: "fallback",
  }),
  headers: () => ({}),
};

const parallelProvider: SearchProvider = {
  name: "parallel",
  url: () => "https://search.parallel.ai/mcp",
  tool: "web_search",
  arguments: (query) => ({ objective: query, search_queries: [query] }),
  headers: () =>
    process.env.PARALLEL_API_KEY ? { Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` } : {},
};

/** Provider ladder, reordered by the optional env override. */
function searchProviders(): SearchProvider[] {
  const providers = [exaProvider, parallelProvider];
  const preferred = process.env.MODUS_WEBSEARCH_PROVIDER;
  providers.sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0));
  return providers;
}

async function callSearchProvider(
  provider: SearchProvider,
  query: string,
  numResults: number,
): Promise<string | undefined> {
  const response = await fetch(provider.url(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "modus/0.1.0",
      ...provider.headers(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: provider.tool, arguments: provider.arguments(query, numResults) },
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${provider.name} search failed with HTTP ${response.status}`);
  }
  return parseMcpToolResponse(await response.text());
}

export type WebSearchResult = {
  provider: string;
  content: string;
};

/** Search the live web, falling back across providers until one answers. */
export async function searchWeb(query: string, numResults?: number): Promise<WebSearchResult> {
  const count = Math.max(1, Math.min(numResults ?? DEFAULT_RESULT_COUNT, 20));
  let lastError: unknown;

  for (const provider of searchProviders()) {
    try {
      const content = await callSearchProvider(provider, query, count);
      if (content?.trim()) {
        return { provider: provider.name, content: content.trim() };
      }
      lastError = new Error(`${provider.name} returned no results.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Web search failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export type WebFetchFormat = "markdown" | "text" | "html";

export type WebFetchResult = {
  url: string;
  title?: string | undefined;
  contentType: string;
  content: string;
  truncated: boolean;
};

let turndown: TurndownService | undefined;

function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    });
    turndown.remove(["script", "style", "meta", "link", "noscript"]);
  }
  return turndown.turndown(html);
}

/** Fetch a page and convert it into something a model can actually read. */
export async function fetchWeb(
  url: string,
  format: WebFetchFormat = "markdown",
  timeoutMs?: number,
): Promise<WebFetchResult> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must start with http:// or https://");
  }

  const timeout = Math.min(timeoutMs ?? FETCH_DEFAULT_TIMEOUT_MS, FETCH_MAX_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept:
        "text/markdown;q=1.0, text/html;q=0.9, application/xhtml+xml;q=0.8, text/plain;q=0.7, */*;q=0.5",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status} for ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const truncated = buffer.byteLength > FETCH_MAX_BYTES;
  const body = (truncated ? buffer.subarray(0, FETCH_MAX_BYTES) : buffer).toString("utf8");
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = /text\/html|application\/xhtml/i.test(contentType);

  let content = body;
  if (isHtml && format === "markdown") {
    content = htmlToMarkdown(body);
  } else if (isHtml && format === "text") {
    content = htmlToText(body);
  }

  return {
    url,
    title: isHtml ? extractHtmlTitle(body) : undefined,
    contentType,
    content,
    truncated,
  };
}
