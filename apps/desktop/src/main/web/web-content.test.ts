import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  extractHtmlTitle,
  htmlToText,
  parseMcpToolResponse,
} from "./web-content";

describe("parseMcpToolResponse", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "search results here" }] },
  });

  it("parses a direct JSON response", () => {
    expect(parseMcpToolResponse(payload)).toBe("search results here");
  });

  it("parses SSE responses line by line", () => {
    const sse = `event: message\ndata: ${payload}\n\n`;
    expect(parseMcpToolResponse(sse)).toBe("search results here");
  });

  it("returns undefined for empty or non-JSON bodies", () => {
    expect(parseMcpToolResponse("")).toBeUndefined();
    expect(parseMcpToolResponse("<html></html>")).toBeUndefined();
  });

  it("surfaces JSON-RPC errors", () => {
    const error = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "rate limited" } });
    expect(() => parseMcpToolResponse(error)).toThrow("rate limited");
  });
});

describe("htmlToText", () => {
  it("drops scripts/styles and collapses whitespace", () => {
    const html =
      "<html><head><style>.a{color:red}</style><script>alert(1)</script></head>" +
      "<body><h1>Title</h1><p>Hello   <b>world</b></p></body></html>";
    expect(htmlToText(html)).toBe("Title\nHello world");
  });

  it("decodes entities", () => {
    expect(htmlToText("<p>a &amp; b &lt;c&gt; &#39;d&#x27;</p>")).toBe("a & b <c> 'd'");
  });
});

describe("decodeHtmlEntities", () => {
  it("keeps unknown entities literal", () => {
    expect(decodeHtmlEntities("&unknown; &amp;")).toBe("&unknown; &");
  });
});

describe("extractHtmlTitle", () => {
  it("reads the title tag", () => {
    expect(extractHtmlTitle("<head><title> My &amp; Page </title></head>")).toBe("My & Page");
  });

  it("returns undefined when missing", () => {
    expect(extractHtmlTitle("<p>no title</p>")).toBeUndefined();
  });
});
