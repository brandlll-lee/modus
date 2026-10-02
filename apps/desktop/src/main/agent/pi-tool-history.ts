import { existsSync, statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentEventItem } from "../../shared/agent-events";
import { toolResultContent } from "./pi-tool-result";

export function restoreToolImages<T extends AgentEventItem>(items: T[], sessionFile?: string): T[] {
  if (
    !sessionFile ||
    !items.some(({ event }) => event.type === "tool.ended" && event.images === undefined) ||
    !existsSync(sessionFile) ||
    statSync(sessionFile).size === 0
  )
    return items;

  const results = new Map<string, ReturnType<typeof toolResultContent>>();
  for (const entry of SessionManager.open(sessionFile).getBranch()) {
    if (entry.type === "message" && entry.message.role === "toolResult")
      results.set(entry.message.toolCallId, toolResultContent(entry.message));
  }
  return items.map((item) => {
    if (item.event.type !== "tool.ended" || item.event.images !== undefined) return item;
    const result = results.get(item.event.toolCallId);
    return result ? { ...item, event: { ...item.event, ...result } } : item;
  });
}
