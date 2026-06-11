import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { TERMINAL_TOOL_UI } from "../../../shared/tools";
import {
  killTerminal,
  listTerminals,
  type RunCommandResult,
  readTerminal,
  runAgentCommand,
  type TerminalRead,
  writeTerminal,
} from "../../terminal/terminal-service";
import { classifyShellCommand, getToolTarget, toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

/**
 * The custom terminal tools are registered once, process-wide, and shared
 * across every agent session; per-session identity comes from the shared
 * agent tool context (see tool-context.ts), resolved via `ctx.cwd`.
 */
const resolveContext = resolveAgentToolContext;

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

function followUpHint(terminalId: string): string {
  return `Use terminal_read with terminal_id "${terminalId}" to read more output as it runs.`;
}

function formatRun(result: RunCommandResult, command: string): string {
  let status: string;
  if (result.status === "exited") {
    status = `exited with code ${result.exitCode ?? 0}`;
  } else if (result.timedOut) {
    status = `still running past the foreground timeout — kept alive as a background terminal. ${followUpHint(result.terminalId)}`;
  } else if (result.background) {
    status = `started in the background. ${followUpHint(result.terminalId)}`;
  } else {
    status = "running";
  }
  const truncated = result.truncated ? "\n[earlier output truncated]" : "";
  const body = result.output.trim() ? `\n\n${result.output}` : "";
  return `$ ${command}\n[terminal ${result.terminalId} — ${status}; cursor=${result.cursor}]${truncated}${body}`;
}

function formatRead(read: TerminalRead): string {
  const header = [
    `terminal ${read.terminalId}`,
    read.status === "exited" ? `exited ${read.exitCode ?? 0}` : "running",
    read.pid !== undefined ? `pid ${read.pid}` : undefined,
    read.command ? `cmd: ${read.command}` : undefined,
    `cursor=${read.cursor}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const truncated = read.truncated ? "\n[earlier output truncated]" : "";
  const body = read.output.trim() ? `\n\n${read.output}` : "\n\n(no new output)";
  return `[${header}]${truncated}${body}`;
}

const runTool: ToolDefinition = defineTool({
  name: "terminal_run",
  label: "Run terminal command",
  description:
    "Run a shell command in a managed terminal that appears in the Modus terminal panel. " +
    "Set background:true for long-lived processes (dev servers, watchers, `tail -f`); the call " +
    "returns immediately with a terminal id you can observe with terminal_read. Foreground " +
    "commands wait for completion; if one outruns its timeout it is kept alive as a background " +
    "terminal instead of being killed. Prefer this over `bash` when the user should see or keep " +
    "the process running in the terminal panel.",
  promptSnippet:
    "terminal_run(command, background?, timeout_ms?) — run a command in a panel terminal; use background:true for servers/watchers.",
  promptGuidelines: [
    "Start dev servers, watchers, and other long-lived processes with terminal_run and background:true, then use terminal_read to check their status instead of blocking.",
    "Use terminal_list to see what is already running before starting a duplicate process.",
  ],
  parameters: Type.Object({
    command: Type.String({ description: "The shell command line to execute." }),
    background: Type.Optional(
      Type.Boolean({
        description:
          "Run as a long-lived background terminal (servers, watchers). Returns immediately. Default false.",
      }),
    ),
    timeout_ms: Type.Optional(
      Type.Number({
        description:
          "Foreground wait in ms before the command is promoted to a background terminal. Default 120000, max 600000.",
      }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const context = resolveContext(ctx.cwd);
    const result = await runAgentCommand({
      workspaceId: context.workspaceId,
      cwd: context.cwd || ctx.cwd,
      sessionId: context.sessionId,
      command: params.command,
      background: params.background ?? false,
      ...(params.timeout_ms !== undefined ? { timeoutMs: params.timeout_ms } : {}),
      ...(context.window ? { window: context.window } : {}),
    });
    return toResult(formatRun(result, params.command), result);
  },
});

const readToolParams = Type.Object({
  terminal_id: Type.String({ description: "Terminal id from terminal_run or terminal_list." }),
  since_cursor: Type.Optional(
    Type.Number({
      description: "Only return output produced after this cursor (from a previous read).",
    }),
  ),
});

const readTool: ToolDefinition = defineTool({
  name: "terminal_read",
  label: "Read terminal output",
  description:
    "Read the current output and status (running/exited, exit code, pid) of a terminal. Pass the " +
    "since_cursor from a previous read to get only new output. Use this to monitor background " +
    "processes started with terminal_run.",
  promptSnippet:
    "terminal_read(terminal_id, since_cursor?) — read a terminal's latest output and status.",
  parameters: readToolParams,
  execute: async (_toolCallId, params: Static<typeof readToolParams>) => {
    const read = readTerminal({
      terminalId: params.terminal_id,
      ...(params.since_cursor !== undefined ? { sinceCursor: params.since_cursor } : {}),
    });
    if (!read) {
      throw new Error(`No terminal with id ${params.terminal_id}.`);
    }
    return toResult(formatRead(read), read);
  },
});

const listTool: ToolDefinition = defineTool({
  name: "terminal_list",
  label: "List terminals",
  description:
    "List the terminals for this session and workspace, with their status, command, and exit code. " +
    "Includes both agent-run command terminals and the user's interactive terminals.",
  promptSnippet: "terminal_list() — list active and recently exited terminals.",
  parameters: Type.Object({}),
  execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
    const context = resolveContext(ctx.cwd);
    const terminals = listTerminals().filter(
      (terminal) =>
        terminal.sessionId === context.sessionId ||
        (terminal.origin === "user" && terminal.workspaceId === context.workspaceId),
    );
    if (terminals.length === 0) {
      return toResult("No terminals are open for this session.", { terminals });
    }
    const lines = terminals.map((terminal) => {
      const state =
        terminal.status === "running" ? "running" : `exited ${terminal.exitCode ?? "?"}`;
      const label = terminal.command ?? `${terminal.shell} (interactive)`;
      return `- ${terminal.id} [${state}] ${terminal.origin}: ${label}`;
    });
    return toResult(`Terminals:\n${lines.join("\n")}`, { terminals });
  },
});

const writeToolParams = Type.Object({
  terminal_id: Type.String({ description: "Terminal id to send input to." }),
  input: Type.String({ description: "Text to send to the terminal's stdin." }),
  submit: Type.Optional(
    Type.Boolean({
      description: "Append Enter (carriage return) after the input. Default true.",
    }),
  ),
});

const writeTool: ToolDefinition = defineTool({
  name: "terminal_write",
  label: "Send terminal input",
  description:
    "Send input/keystrokes to a running terminal (answer a prompt, restart a watcher, send Ctrl-C " +
    "as \\u0003). By default Enter is appended so the input is submitted.",
  promptSnippet: "terminal_write(terminal_id, input, submit?) — send input to a running terminal.",
  parameters: writeToolParams,
  execute: async (_toolCallId, params: Static<typeof writeToolParams>) => {
    const read = readTerminal({ terminalId: params.terminal_id });
    if (!read) {
      throw new Error(`No terminal with id ${params.terminal_id}.`);
    }
    if (read.status === "exited") {
      throw new Error(`Terminal ${params.terminal_id} has already exited.`);
    }
    const data = params.submit === false ? params.input : `${params.input}\r`;
    writeTerminal(params.terminal_id, data);
    return toResult(`Sent input to terminal ${params.terminal_id}.`, {
      terminalId: params.terminal_id,
    });
  },
});

const killToolParams = Type.Object({
  terminal_id: Type.String({ description: "Terminal id to terminate." }),
});

const killTool: ToolDefinition = defineTool({
  name: "terminal_kill",
  label: "Kill terminal",
  description:
    "Stop the process running in a terminal. The terminal stays visible as 'exited' so its output " +
    "remains readable with terminal_read.",
  promptSnippet: "terminal_kill(terminal_id) — stop a running terminal process.",
  parameters: killToolParams,
  execute: async (_toolCallId, params: Static<typeof killToolParams>) => {
    killTerminal(params.terminal_id);
    return toResult(`Requested termination of terminal ${params.terminal_id}.`, {
      terminalId: params.terminal_id,
    });
  },
});

let registered = false;

/** Register the terminal tools into the shared registry (idempotent). */
export function registerTerminalTools(): void {
  if (registered) {
    return;
  }
  registered = true;

  toolRegistry.registerTool({
    entry: {
      name: "terminal_run",
      profiles: ["chat"],
      permission: { danger: "dynamic" },
      ui: TERMINAL_TOOL_UI.terminal_run,
    },
    definition: runTool,
    classify: (event) => classifyShellCommand(getToolTarget(event)),
  });
  toolRegistry.registerTool({
    entry: {
      name: "terminal_read",
      profiles: ["chat"],
      permission: { danger: "safe" },
      ui: TERMINAL_TOOL_UI.terminal_read,
    },
    definition: readTool,
  });
  toolRegistry.registerTool({
    entry: {
      name: "terminal_list",
      profiles: ["chat"],
      permission: { danger: "safe" },
      ui: TERMINAL_TOOL_UI.terminal_list,
    },
    definition: listTool,
  });
  toolRegistry.registerTool({
    entry: {
      name: "terminal_write",
      profiles: ["chat"],
      permission: { danger: "dangerous", action: "shell.execute" },
      ui: TERMINAL_TOOL_UI.terminal_write,
    },
    definition: writeTool,
  });
  toolRegistry.registerTool({
    entry: {
      name: "terminal_kill",
      profiles: ["chat"],
      permission: { danger: "dangerous", action: "shell.execute" },
      ui: TERMINAL_TOOL_UI.terminal_kill,
    },
    definition: killTool,
  });
}
