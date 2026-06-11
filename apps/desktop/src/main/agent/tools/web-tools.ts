import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { WEB_TOOL_UI } from "../../../shared/tools";
import { fetchWeb, searchWeb, type WebFetchFormat } from "../../web/web-service";
import { toolRegistry } from "./registry";

/**
 * Built-in, zero-config web access for the agent. These wrap the main-process
 * `web-service` (real-time search via public Exa/Parallel MCP endpoints + page
 * fetch with HTML→Markdown conversion) and register them into the shared tool
 * registry so they flow through the same activation / UI pipeline as every
 * other agent tool.
 *
 * Both are read-only network reads, so they are classified `safe` and never
 * prompt — matching the no-friction web behavior of Cursor and opencode.
 */

const FETCH_OUTPUT_CAP = 60_000;

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

const searchParams = Type.Object({
  query: Type.String({
    description: "The search query. Describe what you are looking for in natural language.",
  }),
  num_results: Type.Optional(
    Type.Number({
      description: "How many results to return (1-20). Defaults to 8.",
    }),
  ),
});

const searchTool: ToolDefinition = defineTool({
  name: "web_search",
  label: "Search the web",
  description:
    "Search the live web for current information that is not in the codebase or the model's " +
    "training data — latest library versions, API changes, error messages, docs, and recent " +
    "events. Returns ranked results with titles, URLs, and snippets. Follow up with web_fetch " +
    "on a result URL when you need the full page content.",
  promptSnippet:
    "web_search(query, num_results?) — search the live web for up-to-date information.",
  promptGuidelines: [
    "Prefer web_search over guessing when the user asks about current versions, recent releases, or anything time-sensitive.",
    "Write a focused natural-language query describing the ideal page, not just keywords.",
    "After searching, call web_fetch on the most relevant URL when snippets are not enough.",
  ],
  parameters: searchParams,
  execute: async (_toolCallId, params: Static<typeof searchParams>) => {
    const result = await searchWeb(
      params.query,
      params.num_results !== undefined ? params.num_results : undefined,
    );
    return toResult(result.content, { provider: result.provider, query: params.query });
  },
});

const fetchParams = Type.Object({
  url: Type.String({
    description: "The absolute http(s) URL to fetch.",
  }),
  format: Type.Optional(
    Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
      description: "Output format. 'markdown' (default) is best for reading articles and docs.",
    }),
  ),
});

const fetchTool: ToolDefinition = defineTool({
  name: "web_fetch",
  label: "Fetch a web page",
  description:
    "Fetch a single web page or document by URL and return its readable contents. HTML pages are " +
    "converted to Markdown by default so the content is easy to read. Use this to read " +
    "documentation, articles, changelogs, or any page found via web_search.",
  promptSnippet: "web_fetch(url, format?) — fetch a page by URL and read it as markdown/text/html.",
  promptGuidelines: [
    "Pass a complete http(s) URL. Use web_search first if you do not already have a URL.",
    "Long pages are capped; if you need a specific section, fetch and then search within the returned text.",
  ],
  parameters: fetchParams,
  execute: async (_toolCallId, params: Static<typeof fetchParams>) => {
    const format = (params.format ?? "markdown") as WebFetchFormat;
    const result = await fetchWeb(params.url, format);
    const capped = result.content.length > FETCH_OUTPUT_CAP;
    const body = capped ? result.content.slice(0, FETCH_OUTPUT_CAP) : result.content;
    const header = [
      result.title ? `# ${result.title}` : undefined,
      `Source: ${result.url}`,
      capped || result.truncated ? "[content truncated]" : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    return toResult(`${header}\n\n${body}`, {
      url: result.url,
      title: result.title,
      contentType: result.contentType,
      truncated: capped || result.truncated,
    });
  },
});

let registered = false;

/** Register the web tools into the shared registry (idempotent). */
export function registerWebTools(): void {
  if (registered) {
    return;
  }
  registered = true;

  toolRegistry.registerTool({
    entry: {
      name: "web_search",
      profiles: ["chat"],
      permission: { danger: "safe" },
      ui: WEB_TOOL_UI.web_search,
    },
    definition: searchTool,
  });
  toolRegistry.registerTool({
    entry: {
      name: "web_fetch",
      profiles: ["chat"],
      permission: { danger: "safe" },
      ui: WEB_TOOL_UI.web_fetch,
    },
    definition: fetchTool,
  });
}
