import { randomUUID } from "node:crypto";
import type { CheckpointInfo } from "../../shared/contracts";
import { getDatabase } from "../db/database";
import {
  captureCheckoutSnapshot,
  deleteSnapshotRef,
  isGitRepository,
  restoreCheckoutSnapshot,
} from "../git/git-service";

/**
 * Agent checkpoints — Cursor-style safety net.
 *
 * Before every run the session's working tree is snapshotted as a dangling
 * commit (HEAD, index, and checkout files untouched, see git-service). Restoring puts
 * the tree back exactly as it was, and always takes a `restore-backup`
 * snapshot first so a restore is itself undoable.
 */

type CheckpointRow = {
  id: string;
  session_id: string;
  run_id: string | null;
  user_message_id: string | null;
  cwd: string;
  commit_hash: string;
  kind: string;
  created_at: string;
};

function checkpointRef(sessionId: string): string {
  return `refs/modus/checkpoints/${sessionId}`;
}

function toInfo(row: CheckpointRow): CheckpointInfo {
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    ...(row.user_message_id !== null ? { userMessageId: row.user_message_id } : {}),
    cwd: row.cwd,
    commitHash: row.commit_hash,
    kind: row.kind === "restore-backup" ? "restore-backup" : "auto",
    createdAt: row.created_at,
  };
}

function getLastCheckpoint(sessionId: string): CheckpointInfo | undefined {
  const row = getDatabase()
    .prepare(
      `select * from agent_checkpoints
       where session_id = ?
       order by created_at desc, rowid desc
       limit 1`,
    )
    .get(sessionId) as CheckpointRow | undefined;
  return row ? toInfo(row) : undefined;
}

export type CreateCheckpointInput = {
  sessionId: string;
  cwd: string;
  runId?: string | undefined;
  userMessageId?: string | undefined;
  kind?: CheckpointInfo["kind"];
};

/**
 * Snapshot the session's working tree. Returns undefined (instead of
 * throwing) when the cwd is not a git repository — checkpoints must never
 * block a run.
 */
export async function createCheckpoint(
  input: CreateCheckpointInput,
): Promise<CheckpointInfo | undefined> {
  if (!(await isGitRepository(input.cwd))) {
    return undefined;
  }

  const previous = getLastCheckpoint(input.sessionId);
  const snapshot = await captureCheckoutSnapshot(input.cwd, {
    refName: checkpointRef(input.sessionId),
    message: `modus checkpoint (${input.kind ?? "auto"})`,
    parent: previous?.commitHash,
  });

  const info: CheckpointInfo = {
    id: randomUUID(),
    sessionId: input.sessionId,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.userMessageId !== undefined ? { userMessageId: input.userMessageId } : {}),
    cwd: input.cwd,
    commitHash: snapshot.commit,
    kind: input.kind ?? "auto",
    createdAt: new Date().toISOString(),
  };

  getDatabase()
    .prepare(
      `insert into agent_checkpoints
         (id, session_id, run_id, user_message_id, cwd, commit_hash, kind, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      info.id,
      info.sessionId,
      info.runId ?? null,
      info.userMessageId ?? null,
      info.cwd,
      info.commitHash,
      info.kind,
      info.createdAt,
    );

  return info;
}

export function listCheckpoints(sessionId: string): CheckpointInfo[] {
  const rows = getDatabase()
    .prepare(
      `select * from agent_checkpoints
       where session_id = ?
       order by created_at asc, rowid asc`,
    )
    .all(sessionId) as CheckpointRow[];
  return rows.map(toInfo);
}

export function getCheckpoint(checkpointId: string): CheckpointInfo | undefined {
  const row = getDatabase()
    .prepare("select * from agent_checkpoints where id = ?")
    .get(checkpointId) as CheckpointRow | undefined;
  return row ? toInfo(row) : undefined;
}

/**
 * Restore the working tree to a checkpoint. A `restore-backup` snapshot of
 * the current state is taken first so the action is reversible.
 */
export async function restoreCheckpoint(checkpointId: string): Promise<CheckpointInfo> {
  const checkpoint = getCheckpoint(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  await createCheckpoint({
    sessionId: checkpoint.sessionId,
    cwd: checkpoint.cwd,
    kind: "restore-backup",
  });
  await restoreCheckoutSnapshot(checkpoint.cwd, checkpoint.commitHash);
  return checkpoint;
}

/** Cleanup on session delete: drop the keep-alive ref (rows cascade via FK). */
export async function deleteSessionCheckpoints(sessionId: string, cwd: string): Promise<void> {
  await deleteSnapshotRef(cwd, checkpointRef(sessionId)).catch(() => {});
}
