import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { APP_TOOL_UI } from "../../../shared/tools";
import { type LaunchAppResult, launchApp } from "../../process/app-process-service";
import { formatDuration } from "../../terminal/terminal-output";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

function formatLaunch(result: LaunchAppResult): string {
  const durStr = formatDuration(result.durationMs);
  if (!result.alive) {
    return (
      `Launched ${result.command} (pid ${result.pid}) but it exited within ${durStr} — ` +
      "it did NOT stay running as a window app. Treat this as a failed launch: check the " +
      "executable path, the build, and any startup error before reporting success."
    );
  }
  const window = result.windowTitle ? ` — window "${result.windowTitle}"` : "";
  return (
    `Launched ${result.name} (pid ${result.pid})${window} — still running after ${durStr}. ` +
    `Stop it later with terminal_kill terminal_id "${result.id}".`
  );
}

const launchAppTool: ToolDefinition = defineTool({
  name: "launch_app",
  label: "Launch app",
  description:
    "Launch a GUI desktop application as its own independent window process. Use this for programs " +
    "that open a window — editors, IDEs, games, Electron/desktop apps. Modus starts it detached, " +
    "captures the real OS process id, waits briefly, then verifies the window is still running and " +
    "reports its pid and window title. For servers, CLIs, and watchers (no window, you want logs) " +
    "use terminal_run with background:true instead. Stop a launched app later with terminal_kill " +
    "using the returned id.",
  promptSnippet:
    "launch_app(path, args?, cwd?) — start a GUI desktop app as its own window; returns the real OS pid + window title once verified.",
  promptGuidelines: [
    "Use launch_app for anything that opens its own window (editor/IDE/game/desktop app); use terminal_run background:true for servers/CLIs/watchers. Do not launch GUI apps with Start-Process or a detaching shell command.",
    "If launch_app reports the app exited immediately, it failed to start — do not claim success; investigate the path/build.",
  ],
  parameters: Type.Object({
    path: Type.String({
      description: "Executable path of the app to launch (absolute, or relative to cwd).",
    }),
    args: Type.Optional(
      Type.Array(Type.String(), { description: "Command-line arguments passed to the app." }),
    ),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory to launch from. Defaults to the session cwd.",
      }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    const result = await launchApp({
      path: params.path,
      ...(params.args ? { args: params.args } : {}),
      cwd: params.cwd || context.cwd || ctx.cwd,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    });
    return toResult(formatLaunch(result), result);
  },
});

let registered = false;

/** Register the GUI app launch tool into the shared registry (idempotent). */
export function registerAppTools(): void {
  if (registered) {
    return;
  }
  registered = true;
  toolRegistry.registerTool({
    entry: {
      name: "launch_app",
      profiles: ["chat"],
      permission: { danger: "dangerous", action: "shell.execute" },
      ui: APP_TOOL_UI.launch_app,
    },
    definition: launchAppTool,
  });
}
