import { expect, it, vi } from "vitest";

vi.mock("./agent-history", () => ({ readAgentHistory: () => ({ events: [], runs: [] }) }));

import {
  createAgentRun,
  getActiveAgentRun,
  getAgentRun,
  releaseAgentRuns,
  updateAgentRunStatus,
} from "./agent-run-store";

it("tracks a native invocation only while the runtime is attached", () => {
  const sessionId = crypto.randomUUID();
  const run = createAgentRun({ sessionId, prompt: "Question" });
  expect(getActiveAgentRun(sessionId)?.id).toBe(run.id);
  updateAgentRunStatus(run.id, "failed", "Native failure");
  expect(getActiveAgentRun(sessionId)).toBeUndefined();
  expect(getAgentRun(run.id)).toMatchObject({ status: "failed", error: "Native failure" });
  releaseAgentRuns(sessionId);
  expect(getAgentRun(run.id)).toBeUndefined();
});
