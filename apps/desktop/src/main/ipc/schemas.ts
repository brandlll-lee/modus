import { z } from "zod";
import type { ContextItem } from "../../shared/contracts";
import { STARTUP_RENDERER_MILESTONES } from "../../shared/startup";

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const _jsonObjectSchema = z.record(z.string(), z.unknown());
const _optionalHeadersSchema = z.record(z.string(), z.string()).optional();
export const startupMetricSchema = z.object({
  milestone: z.enum(STARTUP_RENDERER_MILESTONES),
  rendererElapsedMs: z.number().finite().nonnegative(),
});
const _modelCostSchema = z
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

export const workspacePinSchema = z.object({
  id: nonEmptyString,
  pinned: z.boolean(),
});

export const workspaceRenameSchema = z.object({
  id: nonEmptyString,
  displayName: z.string().trim().min(1).max(120),
});

export const workspaceIdSchema = z.object({
  id: nonEmptyString,
});

export const sessionPinSchema = z.object({
  id: nonEmptyString,
  pinned: z.boolean(),
});

/** ~10 MB of raw image bytes once base64-decoded. */
const MAX_ATTACHMENT_BASE64_CHARS = 14_000_000;

const promptImageAttachmentSchema = z.object({
  type: z.literal("image"),
  data: z.string().min(1).max(MAX_ATTACHMENT_BASE64_CHARS),
  mimeType: z.string().regex(/^image\/[\w.+-]+$/),
  name: z.string().max(256).optional(),
});

const skillSelectionSchema = z.object({
  name: nonEmptyString,
  path: nonEmptyString,
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
  skills: z.array(skillSelectionSchema).max(1).optional(),
  mode: z.enum(["build", "plan"]).optional(),
  model: optionalNonEmptyString,
  thinkingLevel: thinkingLevelSchema.optional(),
  thinkingVariant: optionalNonEmptyString,
  planId: optionalNonEmptyString,
});

export const sessionIdSchema = nonEmptyString;

export const agentListSchema = z
  .object({
    includeSessionId: optionalNonEmptyString,
  })
  .optional();

export const agentRollbackSchema = z.object({
  sessionId: nonEmptyString,
  userMessageId: nonEmptyString,
});

export const agentSetModelSchema = z.object({
  sessionId: nonEmptyString,
  model: nonEmptyString,
  thinkingLevel: thinkingLevelSchema.optional(),
  thinkingVariant: optionalNonEmptyString,
});

export const agentCycleModelSchema = z.object({
  sessionId: optionalNonEmptyString,
  direction: z.enum(["forward", "backward"]).optional(),
});

export const terminalCreateSchema = z.object({
  workspaceId: nonEmptyString,
  cwd: optionalNonEmptyString,
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

export const processListSchema = z.object({
  workspaceId: optionalNonEmptyString,
  sessionId: optionalNonEmptyString,
  origin: z.enum(["user", "agent"]).optional(),
});

export const processKillSchema = z.object({
  id: nonEmptyString,
});

export const cwdSchema = nonEmptyString;

export const filesListSchema = z.object({
  cwd: nonEmptyString,
  dir: optionalNonEmptyString,
});

export const filesReadSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export const filesWriteSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
  content: z.string(),
});

export const previewReadSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export const browserWorkspaceSchema = z.object({
  workspaceId: nonEmptyString,
});

export const browserCreateTabSchema = z.object({
  workspaceId: nonEmptyString,
  url: z.string().trim().optional(),
});

export const browserTabSchema = z.object({
  tabId: nonEmptyString,
});

export const browserNavigateSchema = z.object({
  tabId: optionalNonEmptyString,
  workspaceId: optionalNonEmptyString,
  url: nonEmptyString,
  newTab: z.boolean().optional(),
});

export const browserBoundsSchema = z.object({
  tabId: nonEmptyString,
  bounds: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(0).max(10_000),
    height: z.number().finite().min(0).max(10_000),
  }),
});

export const browserFindSchema = z.object({
  tabId: nonEmptyString,
  query: nonEmptyString,
  forward: z.boolean().optional(),
  findNext: z.boolean().optional(),
  matchCase: z.boolean().optional(),
});

export const browserFindStopSchema = z.object({
  tabId: nonEmptyString,
  action: z.enum(["clearSelection", "keepSelection", "activateSelection"]).optional(),
});

export const browserRecentSchema = z.object({
  id: nonEmptyString,
});

const hexColor = z.string().trim().min(1).max(64);

export const browserDesignModeSchema = z.object({
  tabId: nonEmptyString,
  enabled: z.boolean(),
  theme: z
    .object({
      accent: hexColor,
      accentContrast: hexColor,
      surface: hexColor,
      elevated: hexColor,
      fg: hexColor,
      fgSubtle: hexColor,
      fontFamily: z.string().trim().min(1).max(512),
      border: hexColor,
      shadow: hexColor,
    })
    .optional(),
});

export const resourceLocationSchema = z.object({
  sessionId: nonEmptyString,
  path: nonEmptyString,
});

export const subagentsGetSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export const subagentsCreateSchema = z.object({
  cwd: nonEmptyString,
  scope: z.enum(["user", "workspace"]).optional(),
  name: nonEmptyString.max(64),
  description: z.string().trim().max(280),
  model: z.string().trim().max(120).optional(),
  readOnly: z.boolean(),
  tools: z.array(z.string().trim().min(1).max(80)).optional(),
  disallowedTools: z.array(z.string().trim().min(1).max(80)).optional(),
  isolation: z.enum(["shared", "worktree"]).optional(),
  body: z.string().trim().min(1).max(20_000),
});

export const subagentsUpdateSchema = subagentsCreateSchema.extend({
  path: nonEmptyString,
});

export const subagentsDeleteSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export const subagentsOpenDirSchema = z.object({
  cwd: nonEmptyString,
  scope: z.enum(["user", "workspace"]).optional(),
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

export const diffTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unstaged") }),
  z.object({ type: z.literal("staged") }),
  z.object({ type: z.literal("commit"), commit: nonEmptyString }),
  z.object({ type: z.literal("branch"), base: optionalNonEmptyString }),
  z.object({ type: z.literal("last-turn"), sessionId: nonEmptyString }),
]);

export const diffReviewSchema = z.object({
  cwd: nonEmptyString,
  target: diffTargetSchema,
});

export const diffStatsSinceSchema = z.object({
  cwd: nonEmptyString,
  base: nonEmptyString,
});

/**
 * Open a workspace file in the OS default app. `path` is the tool's reported
 * path (relative to cwd or absolute); the handler resolves + sandboxes it.
 */
export const fileOpenSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
});

export const diffFilePatchSchema = z.object({
  cwd: nonEmptyString,
  path: nonEmptyString,
  target: diffTargetSchema,
  originalPath: optionalNonEmptyString,
  untracked: z.boolean(),
  ignoreWhitespace: z.boolean(),
});

/** Recent commit history for the All commits scope. */
export const gitLogSchema = z.object({
  cwd: nonEmptyString,
  limit: z.number().int().positive().max(500).optional(),
});

export const diffCommitOrPushSchema = z
  .object({
    cwd: nonEmptyString,
    message: optionalNonEmptyString,
    commit: z.boolean(),
    push: z.boolean(),
    includeUnstaged: z.boolean().optional(),
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

export const permissionDecideSchema = z.object({
  requestId: optionalNonEmptyString,
  sessionId: optionalNonEmptyString,
  action: z.enum([
    "shell.execute",
    "file.write",
    "file.delete",
    "git.write",
    "tool.execute",
    "external.open",
    "browser.control",
  ]),
  target: nonEmptyString,
  decision: z.enum(["allow-once", "allow-workspace", "deny"]),
});

export const approvalModeSchema = z.object({
  mode: z.enum(["request-approval", "auto", "full-access"]),
  /** When set, writes a project override for this cwd instead of the global default. */
  cwd: z.string().min(1).optional(),
});

export const approvalModeGetSchema = z.object({
  cwd: z.string().min(1).optional(),
});

export const approvalModeClearProjectSchema = z.object({
  cwd: z.string().min(1),
});

export const questionRespondSchema = z.object({
  requestId: nonEmptyString,
  skipped: z.boolean(),
  answers: z
    .array(
      z.object({
        questionId: nonEmptyString,
        selected: z.array(z.string()).default([]),
        custom: z.string().optional(),
      }),
    )
    .default([]),
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
      "browser",
      "git-diff",
      "past-chat",
      "project-summary",
      "recent-changes",
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

export const reviewStartSchema = z.object({
  cwd: nonEmptyString,
  sessionId: optionalNonEmptyString,
  workspaceId: optionalNonEmptyString,
  depth: z.enum(["fast", "standard", "deep"]).optional(),
});

export const setModelThinkingSchema = z.object({
  model: nonEmptyString,
  thinkingVariant: nonEmptyString,
});

/** PNG bytes from renderer canvas.encode — Uint8Array survives Electron IPC clone. */
const pngBytesSchema = z.custom<Uint8Array>(
  (value): value is Uint8Array => {
    if (value instanceof Uint8Array) {
      return value.byteLength > 0 && value.byteLength <= 50_000_000;
    }
    // Some Electron builds surface cloned bytes as Buffer on the main side.
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return value.byteLength > 0 && value.byteLength <= 50_000_000;
    }
    return false;
  },
  { message: "png bytes required" },
);

export const clipboardWriteImageSchema = z.object({
  png: pngBytesSchema,
});

export const dialogSaveImageSchema = z.object({
  png: pngBytesSchema,
  defaultName: z.string().trim().min(1).max(200).optional(),
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
