import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { TERMINAL_TOOL_UI } from "../../../shared/tools";
import { isAppId, killApp, listApps } from "../../process/app-process-service";
import { formatDuration } from "../../terminal/terminal-output";
import {
  killTerminal,
  listTerminals,
  type ReadyWhen,
  type RunCommandResult,
  readTerminal,
  runAgentCommand,
  type TerminalRead,
  writeTerminal,
} from "../../terminal/terminal-service";
import {
  classifyShellCommand,
  detectDetachedLaunch,
  getToolTarget,
  toolRegistry,
} from "./registry";
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

/**
 * Render a command result for the model. The only "did it stay running?"
 * judgment is made from authoritative facts — the agent's declared `background`
 * intent and the OS exit code — never by guessing intent from the command text.
 *
 * - background + exited-in-window → the agent declared a long-lived process that
 *   did NOT stay up: warn (it crashed on startup, or a launcher detached).
 * - background + still alive/ready → report liveness/readiness.
 * - foreground + timed out → promoted to a background terminal.
 * - foreground + exited → a one-shot command that completed; success/failure is
 *   the exit code already shown in the status line. No extra note: a foreground
 *   command is *supposed* to run to completion and exit, so exiting is never
 *   itself evidence of failure (this is true for test/build/install/CLI and for
 *   any current or future tool — no per-command special-casing).
 */
export function formatRun(result: RunCommandResult, command: string): string {
  const durStr = formatDuration(result.durationMs);
  let status: string;
  if (result.status === "exited") {
    const code = result.exitCode ?? 0;
    const base = code === 0 ? `exited 0 after ${durStr}` : `FAILED — exit ${code} after ${durStr}`;
    // A background launch that exits inside the watch window did NOT stay
    // running as a process Modus can track — say so explicitly instead of
    // rendering it like an ordinary completed command.
    status = result.background ? `${base} — the launched process did NOT stay running` : base;
  } else if (result.timedOut) {
    status = `still running past the foreground timeout (${durStr}) — kept alive as a background terminal. ${followUpHint(result.terminalId)}`;
  } else if (result.background) {
    if (result.reused) {
      status = `already running (reused the existing terminal for this command instead of starting a duplicate). ${followUpHint(result.terminalId)}`;
    } else if (result.ready) {
      status = `started and READY after ${durStr} — ${result.readySignal}. ${followUpHint(result.terminalId)}`;
    } else if (result.alive && result.ready === false) {
      status = `started and still running after ${durStr}, but NOT yet ready (no readiness signal seen in the window). Confirm with terminal_read before relying on it. ${followUpHint(result.terminalId)}`;
    } else {
      status = `started and still running after ${durStr}. ${followUpHint(result.terminalId)}`;
    }
  } else {
    status = "running";
  }

  const notes: string[] = [];
  if (result.background && result.status === "exited") {
    // Covers both failure shapes: a server/watcher that crashed on startup, and
    // a GUI app whose launcher exits while the real window detaches to its own
    // PID. Either way Modus is no longer tracking a live process — the model
    // must verify the real outcome, not trust this exit.
    notes.push(
      "you launched this with background:true (a long-lived process), but the command exited within the watch window. " +
        "If it is a server/watcher, it FAILED to stay up — do not report success; read the output and fix it. " +
        "If it is a GUI app that detaches its own process, the launcher exiting is expected, but Modus is NOT tracking the real process — confirm it is actually running (e.g. terminal_list, or a process check by name/PID) before reporting success.",
    );
  }
  if (result.portInUse !== undefined) {
    notes.push(
      `port ${result.portInUse} was already in use before launch — a server is likely already running there. Reuse it or free the port instead of starting another instance.`,
    );
  }
  const note = notes.length > 0 ? `\n${notes.map((line) => `[note] ${line}`).join("\n")}` : "";

  const truncated = result.truncated ? "\n[earlier output truncated]" : "";
  const body = result.output.trim() ? `\n\n${result.output}` : "";
  const pid = result.pid !== undefined ? ` (pid ${result.pid})` : "";
  return `$ ${command}\n[terminal ${result.terminalId}${pid} — ${status}; cursor=${result.cursor}]${truncated}${note}${body}`;
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
    "Run a shell command in a managed terminal that appears in the Modus terminal panel.\n" +
    "- One-shot commands (build, test, install, git): run in the foreground (default). Success is exit 0; a non-zero exit is a failure. The result always reports the exit code and how long it ran.\n" +
    "- Long-lived processes (dev servers, apps, watchers): set background:true and pass the program DIRECTLY. Modus watches it for a short window and reports whether it stayed running (ALIVE) or exited. Add ready_when to verify it is actually serving (a port opening, a log line, or an HTTP 2xx) — not just alive.\n" +
    "Do NOT use detaching launchers (Start-Process, start, trailing &, nohup, disown): they hand back the launcher's exit code, not the program's, so Modus cannot tell if it really started. Observe background processes with terminal_read.",
  promptSnippet:
    "terminal_run(command, background?, timeout_ms?, yield_time_ms?, ready_when?, reuse?) — run a command in a panel terminal; use background:true (+ ready_when) for servers/apps/watchers.",
  promptGuidelines: [
    "To start a long-lived process (dev server, app, watcher), use background:true and pass the program directly (e.g. `npm run dev`). NEVER wrap it in Start-Process / start / nohup / a trailing & — those detach the process so Modus cannot verify it started or stays alive.",
    "Treat a foreground command that exits when you intended to start a long-lived process (server/app/watcher) as a FAILURE, not success — it should have kept running. Verify with terminal_read / terminal_list before claiming anything is running.",
    "Verify outcomes, not exit codes: after starting a server, use ready_when (port/log/http) to confirm it is actually serving. Never claim a server or app 'started successfully' from an exit-0 launcher.",
    "Separate setup from start: run blocking setup that must finish first (install/build/migrate) in the foreground, then start the long-lived process with background:true.",
    "Before starting a duplicate server, use terminal_list to see what is already running; reuse is on by default so re-running the same command returns the existing terminal instead of drifting to a new port.",
    "To inspect or stop a process, use the real OS pid Modus reports (`pid N`) or terminal_kill with the terminal id. Do NOT discover PIDs by parsing `ps`: in some shells (e.g. Git Bash `ps -W`) the first column is a shell-internal PID that the OS killer (kill/taskkill) will not recognize — Modus's reported pid is the authoritative OS PID.",
    "Prefer the terminal_* tools over the bash tool for process work (start/inspect/stop): they report the real OS pid, decode output in the host's code page, and terminal_kill stops the whole process tree (freeing held ports).",
  ],
  parameters: Type.Object({
    command: Type.String({ description: "The shell command line to execute." }),
    background: Type.Optional(
      Type.Boolean({
        description:
          "Run as a long-lived background process (servers, apps, watchers). Modus watches it for a yield window and reports ALIVE/EXITED. Default false.",
      }),
    ),
    timeout_ms: Type.Optional(
      Type.Number({
        description:
          "Foreground only: wait in ms before the command is promoted to a background terminal. Default 120000, max 600000.",
      }),
    ),
    yield_time_ms: Type.Optional(
      Type.Number({
        description:
          "Background only: how long (ms) to watch the process for liveness/readiness before returning. Default 2500, range 500–30000.",
      }),
    ),
    ready_when: Type.Optional(
      Type.Object(
        {
          port: Type.Optional(
            Type.Number({
              description:
                "A TCP port that should start accepting connections (e.g. a dev server).",
            }),
          ),
          log: Type.Optional(
            Type.String({
              description:
                'A regex tested against the process output (e.g. "ready in \\\\d+ ms" or "Local:").',
            }),
          ),
          http_url: Type.Optional(
            Type.String({ description: "A URL that should return a 2xx/3xx response." }),
          ),
        },
        {
          description:
            "Background only: readiness contract. The launch is 'ready' once the port accepts connections, the log regex matches, or the URL responds. Lets you verify the process is actually serving, not just alive.",
        },
      ),
    ),
    reuse: Type.Optional(
      Type.Boolean({
        description:
          "Background only: if an identical command is already running in this session/cwd, return that terminal instead of starting a duplicate. Default true.",
      }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const detached = detectDetachedLaunch(params.command);
    if (detached) {
      throw new Error(
        `This command uses "${detached}", which detaches the process so it escapes Modus's terminal. ` +
          `The exit code you'd get back is the launcher's (usually 0), not the program's, so Modus cannot tell whether the program actually started, stayed running, or crashed — this is exactly how a failed launch gets misreported as success. ` +
          `Instead, run the program directly with background:true so Modus owns and watches it, e.g. ` +
          `terminal_run({ command: "<program> <args>", background: true, ready_when: { port: <port> } }). ` +
          `Then confirm with terminal_read / terminal_list.`,
      );
    }
    const context = resolveContext(ctx.cwd);
    const readyWhen = toReadyWhen(params.ready_when);
    const result = await runAgentCommand({
      workspaceId: context.workspaceId,
      cwd: context.cwd || ctx.cwd,
      sessionId: context.sessionId,
      command: params.command,
      background: params.background ?? false,
      ...(params.timeout_ms !== undefined ? { timeoutMs: params.timeout_ms } : {}),
      ...(params.yield_time_ms !== undefined ? { yieldMs: params.yield_time_ms } : {}),
      ...(readyWhen ? { readyWhen } : {}),
      ...(params.reuse !== undefined ? { reuse: params.reuse } : {}),
      ...(context.window ? { window: context.window } : {}),
    });
    return toResult(formatRun(result, params.command), result);
  },
});

/** Map the tool's snake_case `ready_when` shape onto the service `ReadyWhen` type. */
function toReadyWhen(
  input: { port?: number; log?: string; http_url?: string } | undefined,
): ReadyWhen | undefined {
  if (!input) {
    return undefined;
  }
  const ready: ReadyWhen = {};
  if (input.port !== undefined) {
    ready.port = input.port;
  }
  if (input.log !== undefined) {
    ready.log = input.log;
  }
  if (input.http_url !== undefined) {
    ready.httpUrl = input.http_url;
  }
  return Object.keys(ready).length > 0 ? ready : undefined;
}

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
    const apps = listApps({
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    });
    if (terminals.length === 0 && apps.length === 0) {
      return toResult("No terminals or apps are open for this session.", { terminals, apps });
    }
    const terminalLines = terminals.map((terminal) => {
      const state =
        terminal.status === "running" ? "running" : `exited ${terminal.exitCode ?? "?"}`;
      const pid = terminal.pid !== undefined ? `, pid ${terminal.pid}` : "";
      const label = terminal.command ?? `${terminal.shell} (interactive)`;
      return `- ${terminal.id} [${state}${pid}] ${terminal.origin}: ${label}`;
    });
    const appLines = apps.map((app) => {
      const window = app.windowTitle ? ` "${app.windowTitle}"` : "";
      return `- ${app.id} [${app.status}, pid ${app.pid}] app: ${app.name}${window}`;
    });
    const sections = [
      terminalLines.length > 0 ? `Terminals:\n${terminalLines.join("\n")}` : "",
      appLines.length > 0 ? `Apps:\n${appLines.join("\n")}` : "",
    ].filter(Boolean);
    return toResult(sections.join("\n\n"), { terminals, apps });
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
    "Stop the process running in a terminal (by terminal id), including its whole child process tree, " +
    "so ports and resources it held are freed. Preferred over `kill`/`taskkill` with a hand-found PID — " +
    "it uses the real OS process Modus is tracking. The terminal stays visible as 'exited' so its output " +
    "remains readable with terminal_read.",
  promptSnippet: "terminal_kill(terminal_id) — stop a running terminal process.",
  parameters: killToolParams,
  execute: async (_toolCallId, params: Static<typeof killToolParams>) => {
    // Unified stop for any managed process: a launched GUI app (terminate its
    // OS process tree) or a PTY terminal (signal the shell). One tool, both
    // kinds — the agent never needs to know which registry owns the id.
    if (isAppId(params.terminal_id)) {
      await killApp(params.terminal_id);
      return toResult(`Stopped app process ${params.terminal_id}.`, {
        terminalId: params.terminal_id,
      });
    }
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
