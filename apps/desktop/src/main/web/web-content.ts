/**
 * Pure helpers for the web tools (search response parsing, HTML→text) —
 * factored out of web-service.ts so they unit-test without network access.
 */

type McpToolResponse = {
  result?: { content?: Array<{ type?: string; text?: string }> };
  error?: { message?: string };
};

/**
 * Extract the text payload from an MCP `tools/call` HTTP response. Remote
 * search endpoints answer either with plain JSON or an SSE stream whose
 * `data:` lines carry the JSON — both shapes are handled.
 */
export function parseMcpToolResponse(body: string): string | undefined {
  const direct = parsePayload(body.trim());
  if (direct !== undefined) {
    return direct;
  }
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const parsed = parsePayload(line.slice(6).trim());
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function parsePayload(payload: string): string | undefined {
  if (!payload.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(payload) as McpToolResponse;
    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }
    return parsed.result?.content?.find((item) => item.text)?.text;
  } catch (error) {
    if (error instanceof Error && !(error instanceof SyntaxError)) {
      throw error;
    }
    return undefined;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[\da-fA-F]+|\w+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Tags whose entire content is invisible noise for a text reader. */
const SKIPPED_CONTENT = /<(script|style|noscript|template|iframe|svg)\b[\s\S]*?<\/\1\s*>/gi;
/** Block-level boundaries that should become line breaks. */
const BLOCK_BREAK = /<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre|table)>|<br\s*\/?>/gi;

/** Dependency-free HTML → readable plain text (used for format: "text"). */
export function htmlToText(html: string): string {
  const withoutNoise = html.replace(SKIPPED_CONTENT, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutNoise.replace(BLOCK_BREAK, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** <title> contents, for labeling fetched pages. */
export function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1] ? decodeHtmlEntities(match[1]).trim() : undefined;
  return title || undefined;
}
