import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  switch (message.method) {
    case "initialize":
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
      break;
    case "tools/list":
      result = {
        tools: [
          {
            name: "lookup",
            description: "Return the supplied value",
            inputSchema: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
            },
            annotations: { readOnlyHint: true },
          },
        ],
      };
      break;
    case "tools/call":
      result = {
        content: [{ type: "text", text: "fixture result" }],
        structuredContent: { value: message.params.arguments.value },
      };
      break;
    case "ping":
      result = {};
      break;
    default:
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported fixture method" } })}\n`,
      );
      return;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
});
lines.on("close", () => process.exit(0));
