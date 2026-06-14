import { describe, expect, it } from "vitest";
import type { RunCommandResult } from "../../terminal/terminal-service";
import { formatRun } from "./terminal-tools";

/**
 * Base result for a finished command. Tests override only the fields that
 * matter to the case, so each assertion isolates exactly one behavior of
 * `formatRun` — the harness's command-result renderer.
 */
function result(overrides: Partial<RunCommandResult>): RunCommandResult {
  return {
    terminalId: "term-1",
    status: "exited",
    background: false,
    timedOut: false,
    output: "",
    truncated: false,
    cursor: 0,
    durationMs: 500,
    ...overrides,
  };
}

/** Whether the rendered result carries any `[note] …` guidance line. */
function hasNote(text: string): boolean {
  return text.includes("[note]");
}

describe("formatRun — no intent guessing from the command string", () => {
  it("never adds a 'did not stay running' note to a fast foreground exit-0 command", () => {
    // The exact regression: a one-shot command that legitimately exits fast.
    // Outcome is decided purely by the (foreground) declaration + exit code.
    for (const command of [
      "npm test",
      "npx vitest run",
      "node dist/cli.js manifest.json",
      "npm install -D typescript",
      "bun --hot ./server.ts", // a *future* tool we never special-cased
      "deno task dev",
    ]) {
      const text = formatRun(result({ durationMs: 300, exitCode: 0 }), command);
      expect(text).toContain("exited 0 after");
      expect(hasNote(text)).toBe(false);
    }
  });

  it("labels a failed foreground command by its exit code, with no extra note", () => {
    const text = formatRun(result({ exitCode: 1, durationMs: 200 }), "npm run build");
    expect(text).toContain("FAILED — exit 1 after");
    expect(hasNote(text)).toBe(false);
  });
});

describe("formatRun — authoritative signals still produce notes", () => {
  it("warns when a background-declared process exits inside the watch window", () => {
    // The agent itself declared long-lived intent via background:true — that is
    // the authoritative signal, so the warning is justified without any guess.
    const text = formatRun(
      result({ background: true, status: "exited", exitCode: 0, durationMs: 400 }),
      "npm run dev",
    );
    expect(text).toContain("the launched process did NOT stay running");
    expect(text).toContain("background:true");
    expect(hasNote(text)).toBe(true);
  });

  it("reports a live, ready background process without a failure note", () => {
    const text = formatRun(
      result({
        background: true,
        status: "running",
        alive: true,
        ready: true,
        readySignal: "port 5173 is accepting connections",
        durationMs: 1200,
      }),
      "npm run dev",
    );
    expect(text).toContain("READY");
    expect(text).toContain("port 5173 is accepting connections");
    expect(hasNote(text)).toBe(false);
  });

  it("surfaces a port-in-use note (a fact observed before launch)", () => {
    const text = formatRun(
      result({ background: true, status: "running", alive: true, portInUse: 3000 }),
      "npm run dev",
    );
    expect(text).toContain("port 3000 was already in use");
    expect(hasNote(text)).toBe(true);
  });

  it("explains foreground timeout promotion to a background terminal", () => {
    const text = formatRun(
      result({ status: "running", timedOut: true, durationMs: 120_000 }),
      "npm install",
    );
    expect(text).toContain("still running past the foreground timeout");
  });
});
