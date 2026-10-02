import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import type { AgentEventItem } from "../../shared/agent-events";
import { restoreToolImages } from "./pi-tool-history";

it("restores tool images from native history without changing the PI session", () => {
  const root = mkdtempSync(join(tmpdir(), "modus-tool-history-"));
  try {
    const manager = SessionManager.create(root, root);
    manager.appendMessage(fauxAssistantMessage("Inspecting"));
    const image = { type: "image" as const, data: "native-pixels", mimeType: "image/png" };
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "t",
      toolName: "fixture",
      content: [{ type: "text", text: "Native text" }, image],
      isError: false,
      timestamp: Date.now(),
    });
    const file = manager.getSessionFile() as string;
    const before = readFileSync(file, "utf8");
    const entries: AgentEventItem[] = [
      {
        id: "t",
        event: {
          type: "tool.ended",
          sessionId: "s",
          toolCallId: "t",
          output: "GUI text",
          isError: false,
        },
      },
      {
        id: "missing",
        event: {
          type: "tool.ended",
          sessionId: "s",
          toolCallId: "missing",
          output: "Unmatched",
          isError: false,
        },
      },
    ];
    const restored = restoreToolImages(entries, file);
    expect(restored[0]?.event).toMatchObject({ output: "Native text\n", images: [image] });
    expect(restored[1]).toBe(entries[1]);
    expect(restoreToolImages(restored.slice(0, 1), file)[0]).toBe(restored[0]);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(restoreToolImages(entries, join(root, "missing.jsonl"))).toBe(entries);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
