import { z } from "zod";
import type { ContextItem } from "../../shared/contracts";

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const optionalHeadersSchema = z.record(z.string(), z.string()).optional();
const modelCostSchema = z
  .object({
    input: z.number().min(0).optional(),
    output: z.number().min(0).optional(),
    cacheRead: z.number().min(0).optional(),
    cacheWrite: z.number().min(0).optional(),
  })
  .optional();

export const agentCreateSchema = z.object({
  workspaceId: nonEmptyString,
  cwd: nonEmptyString,
  title: nonEmptyString,
  model: optionalNonEmptyString,
  worktreeMode: z.enum(["auto", "off"]).optional(),
});

export const agentPromptSchema = z.object({
  sessionId: nonEmptyString,
  message: nonEmptyString,
  context: z
    .array(z.unknown())
    .transform((items) => items as ContextItem[])
    .optional(),
  delivery: z.enum(["normal", "steer", "follow-up"]).optional(),
  userMessageId: optionalNonEmptyString,
});

export const sessionIdSchema = nonEmptyString;

export const agentSetModelSchema = z.object({
  sessionId: nonEmptyString,
  model: nonEmptyString,
  thinkingLevel: thinkingLevelSchema.optional(),
});

export const agentCycleModelSchema = z.object({
  sessionId: optionalNonEmptyString,
  direction: z.enum(["forward", "backward"]).optional(),
});

export const terminalCreateSchema = z.object({
  workspaceId: nonEmptyString,
  cwd: nonEmptyString,
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
});

export const terminalWriteSchema = z.object({
  terminalId: nonEmptyString,
  data: z.string(),
});

export const terminalResizeSchema = z.object({
  terminalId: nonEmptyString,
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(200),
});

export const cwdSchema = nonEmptyString;

export const diffReadSchema = z.object({
  cwd: nonEmptyString,
  path: optionalNonEmptyString,
  mode: z.enum(["unstaged", "staged", "working-state"]).optional(),
});

export const diffPathSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export const diffCommitSchema = z.object({
  cwd: nonEmptyString,
  message: nonEmptyString,
});

export const permissionDecideSchema = z.object({
  requestId: optionalNonEmptyString,
  sessionId: optionalNonEmptyString,
  action: z.enum([
    "shell.execute",
    "file.write",
    "file.delete",
    "git.write",
    "mcp.call",
    "external.open",
  ]),
  target: nonEmptyString,
  decision: z.enum(["allow-once", "allow-workspace", "deny"]),
});

export const contextSearchSchema = z.object({
  workspaceId: nonEmptyString,
  cwd: nonEmptyString,
  query: z.string(),
  kind: z
    .enum([
      "file",
      "folder",
      "doc",
      "terminal",
      "git-diff",
      "project-summary",
      "recent-changes",
      "rules",
      "search",
    ])
    .optional(),
});

export const contextResolveSchema = z.object({
  cwd: nonEmptyString,
  items: z.array(z.unknown()).transform((items) => items as ContextItem[]),
});

export const docsAddSchema = z.object({
  workspaceId: nonEmptyString,
  title: nonEmptyString,
  path: optionalNonEmptyString,
  url: optionalNonEmptyString,
});

export const docsSearchSchema = z.object({
  workspaceId: nonEmptyString,
  query: z.string(),
});

export const reviewStartSchema = z.object({
  cwd: nonEmptyString,
  sessionId: optionalNonEmptyString,
  workspaceId: optionalNonEmptyString,
  depth: z.enum(["fast", "standard", "deep"]).optional(),
});

export const configureProviderSchema = z.object({
  provider: nonEmptyString,
  apiKey: z.string().optional(),
  enabledModelIds: z.array(nonEmptyString).optional(),
});

const providerCompatibilitySchema = z.object({
  supportsDeveloperRole: z.boolean().optional(),
  supportsReasoningEffort: z.boolean().optional(),
});

const modelCompatibilitySchema = z.object({
  thinkingFormat: z
    .enum([
      "none",
      "openai",
      "openrouter",
      "deepseek",
      "together",
      "zai",
      "qwen",
      "qwen-chat-template",
    ])
    .optional(),
  supportsUsageInStreaming: z.boolean().optional(),
});

export const customProviderModelSchema = z.object({
  id: nonEmptyString,
  name: z.string().optional(),
  api: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().url().optional(),
  headers: optionalHeadersSchema,
  contextWindow: z.number().int().min(1_000).max(10_000_000).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  reasoning: z.boolean().optional(),
  input: z
    .array(z.enum(["text", "image"]))
    .min(1)
    .optional(),
  cost: modelCostSchema,
  compat: jsonObjectSchema.optional(),
  compatibility: modelCompatibilitySchema.optional(),
  thinkingLevelMap: z.partialRecord(thinkingLevelSchema, z.string().nullable()).optional(),
});

export const upsertCustomProviderSchema = z.object({
  provider: nonEmptyString,
  name: nonEmptyString,
  baseUrl: z.string().trim().url(),
  apiKey: z.string().optional(),
  api: z.string().trim().min(1).optional(),
  authHeader: z.boolean().optional(),
  headers: optionalHeadersSchema,
  compat: jsonObjectSchema.optional(),
  compatibility: providerCompatibilitySchema.optional(),
  models: z.array(customProviderModelSchema).min(1),
});

export const updateModelConfigSchema = z.object({
  model: nonEmptyString,
  enabled: z.boolean().optional(),
  thinkingLevel: thinkingLevelSchema.optional(),
  contextWindow: z.number().int().min(1_000).max(10_000_000).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
});

export const worktreeCreateSchema = z.object({
  cwd: nonEmptyString,
  taskId: nonEmptyString,
});

export const worktreeDeleteSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export function parseIpcInput<T>(schema: z.ZodType<T>, value: unknown, channel: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid IPC payload for ${channel}: ${result.error.issues.map((issue) => issue.message).join(", ")}`,
    );
  }
  return result.data;
}
