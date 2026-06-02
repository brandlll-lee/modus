import { PiSdkRuntime } from "./pi-sdk-runtime";
import type { AgentRuntime } from "./runtime";

const runtime = new PiSdkRuntime();

export function getAgentRuntime(): AgentRuntime {
  return runtime;
}
