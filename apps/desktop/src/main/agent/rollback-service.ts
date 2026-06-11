import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentRollbackResult, AgentSessionInfo } from "../../shared/contracts";
import { getDatabase } from "../db/database";
import { getAgentSession, updateAgentSessionStatus } from "./agent-store";
import { restoreCheckpoint } from "./checkpoint-service";
import type { AgentRuntime } from "./runtime";

/**
 * Session rollback — Cursor-style "edit a message & resend".
 *
 * Rolling back to a user message rewinds three kinds of state, in a
 * validate-first order so a failure leaves the session untouched:
 *
 *   1. workspace files — restored from the pre-run checkpoint (a safety
 *      `restore-backup` snapshot is taken first, so even this is undoable);
 *   2. the PI conversation tree — the session file is append-only, so we
 *      re-point its leaf to the entry just before the message (Claude
 *      Code-style branching: nothing is deleted, the abandoned turn simply
 *      becomes an unreachable branch) and persist the new leaf with a marker
 *      entry so the branch survives app restarts;
 *   3. Modus history — agent_events / agent_runs / auto checkpoints from the
 *      message onward are removed in one transaction, which is what the
 *      timeline re-renders from.
 */

/** Sentinel stored in `agent_runs.pi_leaf_before` when the tree was empty. */
export const PI_ROOT_LEAF = "root";

/** `customType` of the marker entry that persists the re-pointed leaf. */
export const ROLLBACK_MARKER_TYPE = "modus.rollback";

type RunRow = {
  row_id: number;
  id: string;
  user_message_id: string | null;
  started_at: string;
  pi_leaf_before: string | null;
};

export type RollbackInput = {
  sessionId: string;
  userMessageId: string;
};

export async function rollbackToUserMessage(
  runtime: Pick<AgentRuntime, "abort" | "dispose">,
  input: RollbackInput,
): Promise<AgentRollbackResult> {
  const session = getAgentSession(input.sessionId);
  if (!session) {
    throw new Error(`Agent session not found: ${input.sessionId}`);
  }

  const db = getDatabase();
  const runs = db
    .prepare(
      `select rowid as row_id, id, user_message_id, started_at, pi_leaf_before
       from agent_runs
       where session_id = ?
       order by rowid asc`,
    )
    .all(input.sessionId) as RunRow[];

  const targetIndex = findTargetRunIndex(runs, input.userMessageId);
  if (targetIndex < 0) {
    throw new Error("Unable to roll back: the run for this message no longer exists.");
  }
  const target = runs[targetIndex] as RunRow;

  // Stop any in-flight turn and drop the live runtime session, so the
  // truncated session file is reloaded from disk on the next prompt and no
  // further entries are appended while we re-point the tree.
  await runtime.abort(input.sessionId).catch(() => {});
  await runtime.dispose(input.sessionId).catch(() => {});

  // Validate-first: resolve and check the conversation branch point before
  // touching anything, so anchor problems abort the rollback cleanly.
  const piTruncation = preparePiTruncation(session, runs, targetIndex);

  // Restore workspace files from the snapshot taken right before this
  // message's run. Failures abort the rollback with history intact.
  const checkpointRow = db
    .prepare(
      `select id from agent_checkpoints
       where session_id = ? and run_id = ? and kind = 'auto'
       order by rowid asc
       limit 1`,
    )
    .get(input.sessionId, target.id) as { id: string } | undefined;
  let filesRestored = false;
  if (checkpointRow) {
    await restoreCheckpoint(checkpointRow.id);
    filesRestored = true;
  }

  // Re-point the conversation tree (append-only: branch + marker entry).
  piTruncation?.();

  const removedRuns = truncateSessionHistory(input.sessionId, target);
  updateAgentSessionStatus(input.sessionId, "idle");

  return {
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    filesRestored,
    ...(checkpointRow ? { checkpointId: checkpointRow.id } : {}),
    removedRuns,
  };
}

/**
 * Find the run a timeline user message belongs to. Messages sent by the
 * composer carry their own id (`local-user:<uuid>`, stored on the run);
 * messages backfilled from legacy runs use the synthetic `user:<runId>` form.
 */
function findTargetRunIndex(runs: RunRow[], userMessageId: string): number {
  const byMessage = runs.findIndex((run) => run.user_message_id === userMessageId);
  if (byMessage >= 0) {
    return byMessage;
  }
  if (userMessageId.startsWith("user:")) {
    const runId = userMessageId.slice("user:".length);
    return runs.findIndex((run) => run.id === runId);
  }
  return -1;
}

/**
 * Resolve the PI session-tree branch point for the target run and return a
 * deferred apply step, or undefined when the session has no persisted file
 * (nothing to truncate). Validation happens here; the returned function only
 * performs infallible appends.
 */
function preparePiTruncation(
  session: AgentSessionInfo,
  runs: RunRow[],
  targetIndex: number,
): (() => void) | undefined {
  const sessionFile = session.piSessionFile;
  if (!sessionFile || !existsSync(sessionFile)) {
    return undefined;
  }

  const manager = SessionManager.open(sessionFile, undefined, session.cwd);
  const target = runs[targetIndex] as RunRow;
  const anchor = target.pi_leaf_before ?? resolveLegacyAnchor(manager, runs, targetIndex);

  if (anchor !== PI_ROOT_LEAF && !manager.getEntry(anchor)) {
    throw new Error("Unable to roll back: the conversation no longer contains this point.");
  }

  return () => {
    if (anchor === PI_ROOT_LEAF) {
      manager.resetLeaf();
    } else {
      manager.branch(anchor);
    }
    // Persist the re-pointed leaf: on reload the leaf is the LAST file entry,
    // so without this marker the branch would be lost on app restart. Custom
    // entries never participate in the LLM context.
    manager.appendCustomEntry(ROLLBACK_MARKER_TYPE, {
      userMessageId: target.user_message_id ?? `user:${target.id}`,
      runId: target.id,
      at: new Date().toISOString(),
    });
  };
}

/**
 * Anchor fallback for runs recorded before `pi_leaf_before` existed: align the
 * Nth run with the Nth user message on the current branch and use its parent.
 * Refuses (with a clear error) when the shapes don't line up 1:1.
 */
function resolveLegacyAnchor(manager: SessionManager, runs: RunRow[], targetIndex: number): string {
  const userEntries = manager.getBranch().filter(
    (entry) =>
      entry.type === "message" &&
      // Bash/custom messages also persist as user-role "message" entries;
      // they carry a customType discriminator and never map to a Modus run.
      (entry.message as { role?: string; customType?: string }).role === "user" &&
      !("customType" in entry.message),
  );
  if (userEntries.length !== runs.length) {
    throw new Error(
      "Unable to roll back: this conversation predates rollback support and its history can't be aligned safely.",
    );
  }
  const entry = userEntries[targetIndex] as { parentId: string | null };
  return entry.parentId ?? PI_ROOT_LEAF;
}

/**
 * Remove events / runs / auto-checkpoints from the target message onward in
 * one transaction. Restore-backup checkpoints are kept: they're invisible in
 * the UI and preserve the git keep-alive chain (the next snapshot parents onto
 * the newest remaining commit).
 */
function truncateSessionHistory(sessionId: string, target: RunRow): number {
  const db = getDatabase();

  const runRows = db
    .prepare("select id from agent_runs where session_id = ? and rowid >= ? order by rowid asc")
    .all(sessionId, target.row_id) as Array<{ id: string }>;
  const runIds = runRows.map((row) => row.id);

  // The first event of the rolled-back range: the user message's own
  // `message.started`, falling back to the run's `run.started` and finally to
  // a started_at timestamp cut for legacy histories without either row.
  const eventAnchor =
    findEventRowid(sessionId, "message.started", "$.messageId", target.user_message_id) ??
    findEventRowid(sessionId, "run.started", "$.runId", target.id);

  db.exec("begin");
  try {
    if (eventAnchor !== undefined) {
      db.prepare("delete from agent_events where session_id = ? and rowid >= ?").run(
        sessionId,
        eventAnchor,
      );
    } else {
      db.prepare("delete from agent_events where session_id = ? and created_at >= ?").run(
        sessionId,
        target.started_at,
      );
    }

    if (runIds.length > 0) {
      const placeholders = runIds.map(() => "?").join(", ");
      db.prepare(
        `delete from agent_checkpoints
         where session_id = ? and kind = 'auto' and run_id in (${placeholders})`,
      ).run(sessionId, ...runIds);
    }

    db.prepare("delete from agent_runs where session_id = ? and rowid >= ?").run(
      sessionId,
      target.row_id,
    );
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }

  return runIds.length;
}

function findEventRowid(
  sessionId: string,
  type: string,
  jsonPath: string,
  value: string | null,
): number | undefined {
  if (value === null) {
    return undefined;
  }
  const row = getDatabase()
    .prepare(
      `select min(rowid) as row_id from agent_events
       where session_id = ? and type = ? and json_extract(payload_json, ?) = ?`,
    )
    .get(sessionId, type, jsonPath, value) as { row_id: number | null } | undefined;
  return row?.row_id ?? undefined;
}
