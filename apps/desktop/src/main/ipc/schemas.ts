import { z } from "zod";
import { STARTUP_RENDERER_MILESTONES } from "../../shared/startup";

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const startupMetricSchema = z.object({
  milestone: z.enum(STARTUP_RENDERER_MILESTONES),
  rendererElapsedMs: z.number().finite().nonnegative(),
});

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

export const promptImageAttachmentSchema = z.object({
  type: z.literal("image"),
  data: z.string().min(1),
  mimeType: z.string().regex(/^image\/[\w.+-]+$/),
  name: z.string().max(256).optional(),
  path: optionalNonEmptyString,
});

const skillSelectionSchema = z.object({
  name: nonEmptyString,
  path: nonEmptyString,
});

export const agentPromptSchema = z
  .object({
    sessionId: nonEmptyString,
    message: z.string().trim(),
    paths: z.array(nonEmptyString).optional(),
    delivery: z.enum(["normal", "steer", "follow-up"]).optional(),
    userMessageId: optionalNonEmptyString,
    attachments: z.array(promptImageAttachmentSchema).optional(),
    skills: z.array(skillSelectionSchema).max(1).optional(),
    model: optionalNonEmptyString,
    thinkingLevel: thinkingLevelSchema.optional(),
    thinkingVariant: optionalNonEmptyString,
  })
  .refine(
    (input) =>
      input.message.length > 0 ||
      Boolean(input.attachments?.length || input.paths?.length || input.skills?.length),
    {
      message: "A prompt needs text, a file, an image, or a skill.",
    },
  );

export const sessionIdSchema = nonEmptyString;

export const agentNavigateSchema = z.object({
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

export const resourceLocationSchema = z.object({
  sessionId: nonEmptyString,
  path: nonEmptyString,
});

export const mcpCommandSchema = z.object({
  sessionId: nonEmptyString,
  name: nonEmptyString,
  args: z.string(),
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
]);

export const diffReviewSchema = z.object({
  cwd: nonEmptyString,
  target: diffTargetSchema,
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
