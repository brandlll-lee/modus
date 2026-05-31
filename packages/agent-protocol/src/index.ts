export type AgentRuntimeEvent =
  | { type: "agent.started"; sessionId: string }
  | { type: "message.delta"; sessionId: string; delta: string }
  | { type: "tool.started"; sessionId: string; toolCallId: string; toolName: string }
  | { type: "tool.output"; sessionId: string; toolCallId: string; output: string }
  | { type: "tool.ended"; sessionId: string; toolCallId: string; isError: boolean }
  | { type: "agent.ended"; sessionId: string };
