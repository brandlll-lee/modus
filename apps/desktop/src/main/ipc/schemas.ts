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
});

/** ~10 MB of raw image bytes once base64-decoded. */
const MAX_ATTACHMENT_BASE64_CHARS = 14_000_000;

const promptImageAttachmentSchema = z.object({
  type: z.literal("image"),
  data: z.string().min(1).max(MAX_ATTACHMENT_BASE64_CHARS),
  mimeType: z.string().regex(/^image\/[\w.+-]+$/),
  name: z.string().max(256).optional(),
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
  attachments: z.array(promptImageAttachmentSchema).max(6).optional(),
  skills: z.array(nonEmptyString).max(10).optional(),
});

export const sessionIdSchema = nonEmptyString;

export const agentRollbackSchema = z.object({
  sessionId: nonEmptyString,
  userMessageId: nonEmptyString,
});

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

export const skillsGetSchema = z.object({
  cwd: nonEmptyString,
  id: nonEmptyString,
});

export const skillsCreateSchema = z.object({
  cwd: nonEmptyString,
  name: nonEmptyString.max(64),
  description: z.string().trim().max(280),
  body: z.string().trim().min(1).max(20_000),
});

export const diffReadSchema = z.object({
  cwd: nonEmptyString,
  path: optionalNonEmptyString,
  mode: z.enum(["unstaged", "staged", "working-state"]).optional(),
});

export const diffPathSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

/**
 * Open a workspace file in the OS default app. `path` is the tool's reported
 * path (relative to cwd or absolute); the handler resolves + sandboxes it.
 */
export const fileOpenSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export const diffFileVersionsSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
  mode: z.enum(["unstaged", "staged"]).optional(),
  originalPath: optionalNonEmptyString,
});

export const diffCommitSchema = z.object({
  cwd: nonEmptyString,
  message: nonEmptyString,
});

export const diffCommitOrPushSchema = z
  .object({
    cwd: nonEmptyString,
    message: optionalNonEmptyString,
    stageAll: z.boolean().optional(),
    commit: z.boolean(),
    push: z.boolean(),
  })
  .refine((value) => value.commit || value.push, {
    message: "At least one of commit or push must be requested.",
  })
  .refine((value) => !value.commit || (value.message?.trim().length ?? 0) > 0, {
    message: "Commit message is required when committing.",
  });

export const gitCheckoutSchema = z.object({
  cwd: nonEmptyString,
  name: nonEmptyString,
  remote: z.boolean().optional(),
});

export const gitCreateBranchSchema = z.object({
  cwd: nonEmptyString,
  name: nonEmptyString,
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

export const checkpointRestoreSchema = z.object({
  checkpointId: nonEmptyString,
});

const stringRecordSchema = z.record(z.string(), z.string());

export const mcpUpsertSchema = z
  .object({
    cwd: nonEmptyString,
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[\w.-]+$/, "Server names may use letters, numbers, dot, dash and underscore."),
    originalName: optionalNonEmptyString,
    transport: z.enum(["stdio", "http"]),
    command: z.string().trim().optional(),
    args: z.array(z.string()).max(64).optional(),
    env: stringRecordSchema.optional(),
    url: z.string().trim().optional(),
    headers: stringRecordSchema.optional(),
    enabled: z.boolean(),
  })
  .refine((value) => (value.transport === "stdio" ? Boolean(value.command?.trim()) : true), {
    message: "Local servers need a command.",
  })
  .refine(
    (value) =>
      value.transport === "http" ? Boolean(value.url && /^https?:\/\//.test(value.url)) : true,
    { message: "Remote servers need an http(s) URL." },
  );

export const mcpServerNameSchema = z.object({
  cwd: nonEmptyString,
  name: nonEmptyString,
});

export const mcpSetEnabledSchema = z.object({
  cwd: nonEmptyString,
  name: nonEmptyString,
  enabled: z.boolean(),
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
      "string-thinking",
    ])
    .optional(),
  supportsUsageInStreaming: z.boolean().optional(),
  forceAdaptiveThinking: z.boolean().optional(),
  allowEmptySignature: z.boolean().optional(),
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

export const testCustomProviderSchema = z.object({
  provider: optionalNonEmptyString,
  baseUrl: z.string().trim().url(),
  api: z.string().trim().min(1).optional(),
  apiKey: z.string().optional(),
  authHeader: z.boolean().optional(),
  headers: optionalHeadersSchema,
  model: z.object({
    id: nonEmptyString,
    api: z.string().trim().min(1).optional(),
    baseUrl: z.string().trim().url().optional(),
    headers: optionalHeadersSchema,
    reasoning: z.boolean().optional(),
    contextWindow: z.number().int().min(1_000).max(10_000_000).optional(),
    maxTokens: z.number().int().min(1).max(1_000_000).optional(),
    compat: jsonObjectSchema.optional(),
    compatibility: modelCompatibilitySchema.optional(),
    thinkingLevelMap: z.partialRecord(thinkingLevelSchema, z.string().nullable()).optional(),
  }),
});

export const updateModelConfigSchema = z.object({
  model: nonEmptyString,
  enabled: z.boolean().optional(),
  thinkingLevel: thinkingLevelSchema.optional(),
  contextWindow: z.number().int().min(1_000).max(10_000_000).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
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
