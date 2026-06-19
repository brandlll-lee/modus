import type { AgentEvent } from "./contracts";

export type AgentEventItem = { id: string; event: AgentEvent; createdAt?: string };

/**
 * Fold key = the event's own authoritative stream identity.
 *
 * Streamed deltas of one logical part (a message's text, a message's thinking,
 * a tool call's output, a tool call's live args) all carry the id that part was
 * opened with — `messageId` or `toolCallId`. We key the fold on that id, never
 * on array position. So interleaved streams (thinking → text → tool → thinking)
 * still collapse correctly, and a session's event list stays O(parts) instead
 * of O(deltas): one accumulated item per stream, not one per chunk.
 *
 * Non-delta events (started/completed/ended/…) return no key and are kept
 * verbatim in arrival order.
 */
function foldKey(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "message.delta":
    case "thinking.delta":
      return `${event.type}:${event.messageId}`;
    case "tool.output":
    case "tool.delta":
      return `${event.type}:${event.toolCallId}`;
    default:
      return undefined;
  }
}

/**
 * Accumulate `next` into the matching `previous` item. The accumulation rule is
 * a property of the field, not the tool/message identity: text-bearing deltas
 * concatenate their growing field; a `tool.delta` carries the full args-so-far,
 * so the latest simply wins. `foldKey` guarantees both share the same type.
 */
function foldInto<T extends AgentEventItem>(previous: T, next: T): T {
  const prev = previous.event;
  const cur = next.event;
  if (prev.type === "message.delta" && cur.type === "message.delta") {
    return { ...previous, event: { ...prev, delta: prev.delta + cur.delta } } as T;
  }
  if (prev.type === "thinking.delta" && cur.type === "thinking.delta") {
    return { ...previous, event: { ...prev, delta: prev.delta + cur.delta } } as T;
  }
  if (prev.type === "tool.output" && cur.type === "tool.output") {
    return { ...previous, event: { ...prev, output: prev.output + cur.output } } as T;
  }
  return next;
}

/**
 * Append freshly streamed items onto an event list, folding each delta into its
 * stream's single accumulated item (keyed by the part id the event carries).
 * Only the folded item gets a new reference, so React state updates stay cheap.
 * Cost is O(existing parts + new items): the index is rebuilt from the already
 * folded list, which is bounded by part count, not chunk count.
 */
export function appendAgentEvents<T extends AgentEventItem>(events: T[], nextItems: T[]): T[] {
  const result = events.slice();
  const indexByKey = new Map<string, number>();
  result.forEach((entry, i) => {
    const key = foldKey(entry.event);
    if (key !== undefined) {
      indexByKey.set(key, i);
    }
  });
  for (const item of nextItems) {
    const key = foldKey(item.event);
    if (key !== undefined) {
      const at = indexByKey.get(key);
      const existing = at === undefined ? undefined : result[at];
      if (at !== undefined && existing !== undefined) {
        result[at] = foldInto(existing, item);
        continue;
      }
      indexByKey.set(key, result.length);
    }
    result.push(item);
  }
  return result;
}

/** Fold a complete event list (e.g. a session's persisted history) in one pass. */
export function foldAgentEvents<T extends AgentEventItem>(items: T[]): T[] {
  return appendAgentEvents([], items);
}
