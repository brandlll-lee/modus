import { randomUUID } from "node:crypto";
import { DEFAULT_APPROVAL_MODE, isApprovalMode } from "../../shared/approval";
import type { ApprovalMode, PermissionAction, PermissionDecision } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type PermissionRow = {
  id: string;
  action: PermissionAction;
  target: string;
  decision: PermissionDecision["decision"];
  created_at: string;
};

export function normalizePermissionTarget(target: string): string {
  return target.trim().replace(/\s+/g, " ");
}

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
    target: normalizePermissionTarget(target),
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

/** Global approval mode (persisted in app_settings; defaults to the safe mode). */
const APPROVAL_MODE_KEY = "approval_mode";

export function getApprovalMode(): ApprovalMode {
  const row = getDatabase()
    .prepare("select value from app_settings where key = ?")
    .get(APPROVAL_MODE_KEY) as { value: string | null } | undefined;
  return isApprovalMode(row?.value) ? row.value : DEFAULT_APPROVAL_MODE;
}

export function setApprovalMode(mode: ApprovalMode): ApprovalMode {
  getDatabase()
    .prepare(
      `insert into app_settings (key, value, updated_at)
       values (?, ?, ?)
       on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(APPROVAL_MODE_KEY, mode, new Date().toISOString());
  return mode;
}

export function findWorkspaceAllowDecision(
  action: PermissionAction,
  target: string,
): PermissionDecision | undefined {
  const row = getDatabase()
    .prepare(
      `select id, action, target, decision, created_at
       from permissions
       where action = ? and target = ? and decision = 'allow-workspace'
       order by created_at desc
       limit 1`,
    )
    .get(action, normalizePermissionTarget(target)) as PermissionRow | undefined;

  return row ? toPermission(row) : undefined;
}
