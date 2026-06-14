import type { ApprovalMode, PermissionAction } from "./contracts";

/**
 * Single source of truth for the global approval-mode model (the composer's
 * permission picker). Shared by the main-process decision point
 * (`pi-permission-extension`), the renderer selector, and tests.
 *
 * Design note: Codex models permissions on two axes — `AskForApproval` (when to
 * prompt) and a sandbox `PermissionProfile` (what's allowed). Modus has no OS
 * sandbox, so the capability axis has nothing to enforce and the model collapses
 * to a single "when to prompt" axis over Modus's existing danger classification.
 * The three modes therefore form a prompting ladder, not three sandboxes.
 */

export type ApprovalModeMeta = {
  id: ApprovalMode;
  label: string;
  description: string;
};

/** O(1), always-defined lookup of a mode's metadata by id (the source of truth). */
export const APPROVAL_MODE_BY_ID: Record<ApprovalMode, ApprovalModeMeta> = {
  "request-approval": {
    id: "request-approval",
    label: "Request approval",
    description: "Ask before edits, commands, and other risky actions.",
  },
  auto: {
    id: "auto",
    label: "Auto",
    description: "Only ask for high-risk actions like deletes and git pushes.",
  },
  "full-access": {
    id: "full-access",
    label: "Full access",
    description: "Never ask. Unrestricted access to your files.",
  },
};

/** Picker order matches the composer (safest first). */
export const APPROVAL_MODES: readonly ApprovalModeMeta[] = [
  APPROVAL_MODE_BY_ID["request-approval"],
  APPROVAL_MODE_BY_ID.auto,
  APPROVAL_MODE_BY_ID["full-access"],
];

export const DEFAULT_APPROVAL_MODE: ApprovalMode = "request-approval";

/** Actions destructive enough to still prompt under the `auto` mode. */
const HIGH_RISK_ACTIONS: ReadonlySet<PermissionAction> = new Set<PermissionAction>([
  "file.delete",
  "git.write",
]);

export function actionRisk(action: PermissionAction): "high" | "medium" {
  return HIGH_RISK_ACTIONS.has(action) ? "high" : "medium";
}

/**
 * The whole feature in one pure function: given the global mode and a tool's
 * danger classification, decide whether the agent must pause for approval.
 * - `request-approval`: every dangerous action prompts (the safe default).
 * - `auto`: only high-risk actions prompt; ordinary writes/commands run.
 * - `full-access`: nothing prompts.
 * Non-dangerous actions never prompt, regardless of mode.
 */
export function shouldPrompt(
  mode: ApprovalMode,
  action: PermissionAction,
  dangerous: boolean,
): boolean {
  if (!dangerous) return false;
  if (mode === "full-access") return false;
  if (mode === "auto") return actionRisk(action) === "high";
  return true;
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "request-approval" || value === "auto" || value === "full-access";
}
