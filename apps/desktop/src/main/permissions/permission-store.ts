import { randomUUID } from "node:crypto";
import type { PermissionAction, PermissionDecision } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type PermissionRow = {
  id: string;
  action: PermissionAction;
  target: string;
  decision: PermissionDecision["decision"];
  created_at: string;
};

function toPermission(row: PermissionRow): PermissionDecision {
  return {
    id: row.id,
    action: row.action,
    target: row.target,
    decision: row.decision,
    createdAt: row.created_at,
  };
}

export function recordPermissionDecision(
  action: PermissionAction,
  target: string,
  decision: PermissionDecision["decision"],
): PermissionDecision {
  const entry = {
    id: randomUUID(),
    action,
    target,
    decision,
    createdAt: new Date().toISOString(),
  };

  getDatabase()
    .prepare(
      `insert into permissions (id, action, target, decision, created_at)
       values (?, ?, ?, ?, ?)`,
    )
    .run(entry.id, entry.action, entry.target, entry.decision, entry.createdAt);

  return entry;
}

export function listPermissionDecisions(): PermissionDecision[] {
  const rows = getDatabase()
    .prepare(
      `select id, action, target, decision, created_at
       from permissions
       order by created_at desc
       limit 100`,
    )
    .all() as PermissionRow[];

  return rows.map(toPermission);
}
