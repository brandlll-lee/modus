import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { WAIT_TOOL_NAME, WAIT_TOOL_UI } from "../../../shared/tools";
import type { AgentRuntime } from "../runtime";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

type WaitToolOps = Pick<AgentRuntime, "waitBackground">;

let ops: WaitToolOps | undefined;
let registered = false;

function currentOps(): WaitToolOps {
  if (!ops) {
    throw new Error("Wait tools are not ready yet.");
  }
  return ops;
}

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

/** Clamp caller-declared timeout; 0 = status snapshot only. */
const TIMEOUT_MIN_MS = 0;
const TIMEOUT_MAX_MS = 600_000;
const TIMEOUT_DEFAULT_MS = 120_000;

/** Tool-result budget: full report lives in the subagent preview. */
const OUTPUT_EXCERPT_CHARS = 600;

function clampTimeoutMs(value: number | undefined): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : TIMEOUT_DEFAULT_MS;
  return Math.min(TIMEOUT_MAX_MS, Math.max(TIMEOUT_MIN_MS, Math.floor(raw)));
}

export function formatWaitedDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** First-line UI/tool headline from wait result facts (not free-text guessing). */
export function formatWaitHeadline(result: {
  waitedMs: number;
  timedOut: boolean;
  subagents: readonly unknown[];
}): string {
  const dur = formatWaitedDuration(result.waitedMs);
  const nSub = result.subagents.length;
  const forWhat = nSub > 0 ? ` for ${nSub === 1 ? "subagent" : `${nSub} subagents`}` : "";
  const timedOut = result.timedOut ? " (timed out)" : "";
  return `Waited ${dur}${forWhat}${timedOut}`;
}

export function excerptForWaitTool(output: string, maxChars = OUTPUT_EXCERPT_CHARS): string {
  const trimmed = output.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n…(full report in subagent preview)`;
}

const waitParams = Type.Object({
  timeout_ms: Type.Optional(
    Type.Number({
      description:
        `Max time to block this turn waiting (ms). Default ${TIMEOUT_DEFAULT_MS}. ` +
        `0 returns a status snapshot immediately. Clamped to ${TIMEOUT_MAX_MS}.`,
    }),
  ),
  subagent_ids: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description:
        "Background subagent ids to wait for. Omit to wait for all background subagents of this session.",
    }),
  ),
});

const waitTool: ToolDefinition = defineTool({
  name: WAIT_TOOL_NAME,
  label: "Wait",
  description:
    "Block this turn until all watched background subagents settle, or until timeout. " +
    "Keeps the same turn open so you can use every result without a new message.",
  promptSnippet:
    "wait(timeout_ms?, subagent_ids?) — hold this turn until watched background subagents finish (or timeout).",
  promptGuidelines: [
    "After launching tasks, first do any useful main-thread work (read/grep/explore) that does not need those results — then call wait.",
    "Do NOT call wait immediately after task() unless you truly have nothing else useful to do in parallel.",
    "wait returns when ALL watched items settle (completed/error/exited), or when timeout_ms elapses.",
    "Omit subagent_ids to watch every background subagent of this session; pass ids for a subset.",
    "On timeout, still-running work remains — call wait again if needed. DO NOT sleep or poll.",
    "Background results are ONLY available through wait — they are never auto-injected into the chat. Open the subagent preview for the full report.",
  ],
  parameters: waitParams,
  execute: async (_toolCallId, params: Static<typeof waitParams>, signal, onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.sessionId) {
      throw new Error("No active Modus session for wait.");
    }
    const timeoutMs = clampTimeoutMs(params.timeout_ms);
    const result = await currentOps().waitBackground({
      sessionId: context.parentSessionId ?? context.sessionId,
      timeoutMs,
      ...(params.subagent_ids ? { subagentIds: params.subagent_ids } : {}),
      ...(signal ? { signal } : {}),
      onProgress: (text) => {
        onUpdate?.(toResult(text, undefined));
      },
    });

    const lines = [formatWaitHeadline(result), ""];
    if (result.subagents.length === 0) {
      lines.push("Nothing to wait for.");
    }
    for (const child of result.subagents) {
      lines.push(`subagent ${child.id} [${child.status}] ${child.task}`);
      if (child.output) {
        lines.push(excerptForWaitTool(child.output));
        lines.push("---");
      }
    }
    const final = toResult(lines.join("\n").trimEnd(), result);
    onUpdate?.(final);
    return final;
  },
});

export function registerWaitTools(nextOps: WaitToolOps): void {
  ops = nextOps;
  if (registered) {
    return;
  }
  registered = true;
  toolRegistry.registerTool({
    entry: {
      name: WAIT_TOOL_NAME,
      profiles: ["chat"],
      permission: { danger: "safe" },
      capabilities: ["process"],
      ui: WAIT_TOOL_UI,
    },
    definition: waitTool,
  });
}
