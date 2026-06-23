import { describe, expect, it } from "vitest";
import type { AgentSessionInfo } from "../../../../shared/contracts";
import { formatConflictResolutionPrompt } from "./SubagentsPanel";

describe("formatConflictResolutionPrompt", () => {
  it("includes the authoritative worktree conflict context", () => {
    const session: AgentSessionInfo = {
      id: "child",
      workspaceId: "workspace",
      title: "child title",
      cwd: "F:\\repo\\.modus\\worktrees\\child",
      status: "completed",
      parentSessionId: "root",
      subagentTask: "add formatter",
      subagentWorktree: {
        path: "F:\\repo\\.modus\\worktrees\\child",
        branch: "modus/subagent/child",
        baseSha: "abc123",
        integrationStatus: "conflict",
        changedFiles: ["src/formatter.js"],
        conflictFiles: ["src/formatter.js"],
      },
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:01:00.000Z",
    };

    const prompt = formatConflictResolutionPrompt(session, "F:\\repo");

    expect(prompt).toContain('Resolve the merge conflicts from subagent "add formatter".');
    expect(prompt).toContain("- Main workspace: F:\\repo");
    expect(prompt).toContain("- Subagent branch: modus/subagent/child");
    expect(prompt).toContain("- Base SHA: abc123");
    expect(prompt).toContain("- Conflict files: src/formatter.js");
    expect(prompt).toContain("Do not commit.");
  });
});
