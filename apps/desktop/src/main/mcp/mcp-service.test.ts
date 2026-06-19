import { describe, expect, it } from "vitest";
import { listAllMcpTools } from "./mcp-service";

describe("listAllMcpTools", () => {
  it("follows MCP pagination cursors", async () => {
    const cursors: Array<string | undefined> = [];
    const client = {
      async listTools(params?: { cursor?: string }) {
        cursors.push(params?.cursor);
        if (!params?.cursor) {
          return {
            tools: [{ name: "first", inputSchema: { type: "object" as const } }],
            nextCursor: "next",
          };
        }
        return { tools: [{ name: "second", inputSchema: { type: "object" as const } }] };
      },
    };

    await expect(listAllMcpTools(client, "server")).resolves.toMatchObject([
      { name: "first" },
      { name: "second" },
    ]);
    expect(cursors).toEqual([undefined, "next"]);
  });
});
