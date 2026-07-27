import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { DEFAULT_APPROVAL_MODE, isApprovalMode } from "../../shared/approval";
import type { ApprovalMode, ApprovalModeState, PermissionAction, PermissionDecision } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type PermissionRow = {
  id: string;
  action: PermissionAction;
  target: string;
  decision: PermissionDecision["decision"];
  created_at: string;
};

export type { ApprovalModeState };

export function normalizePermissionTarget(target: string): string {
  return target.trim().replace(/\s+/g, " ");
}

/** Stable key fragment for project-scoped approval overrides. */
export function normalizeApprovalCwd(cwd: string): string {
  return resolvePath(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
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

/** Global approval mode key (persisted in app_settings). */
const APPROVAL_MODE_KEY = "approval_mode";

function projectApprovalModeKey(cwd: string): string {
  return `approval_mode:cwd:${normalizeApprovalCwd(cwd)}`;
}

function readSetting(key: string): string | undefined {
  const row = getDatabase()
    .prepare("select value from app_settings where key = ?")
    .get(key) as { value: string | null } | undefined;
  return row?.value ?? undefined;
}

function writeSetting(key: string, value: string): void {
  getDatabase()
    .prepare(
      `insert into app_settings (key, value, updated_at)
       values (?, ?, ?)
       on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}

function deleteSetting(key: string): void {
  getDatabase().prepare("delete from app_settings where key = ?").run(key);
}

export function getGlobalApprovalMode(): ApprovalMode {
  const value = readSetting(APPROVAL_MODE_KEY);
  return isApprovalMode(value) ? value : DEFAULT_APPROVAL_MODE;
}

export function setGlobalApprovalMode(mode: ApprovalMode): ApprovalMode {
  writeSetting(APPROVAL_MODE_KEY, mode);
  return mode;
}

export function getProjectApprovalMode(cwd: string): ApprovalMode | undefined {
  const value = readSetting(projectApprovalModeKey(cwd));
  return isApprovalMode(value) ? value : undefined;
}

export function setProjectApprovalMode(cwd: string, mode: ApprovalMode): ApprovalMode {
  writeSetting(projectApprovalModeKey(cwd), mode);
  return mode;
}

export function clearProjectApprovalMode(cwd: string): void {
  deleteSetting(projectApprovalModeKey(cwd));
}

/**
 * Resolve the approval mode for a session cwd:
 * project override → global → builtin default.
 * Omit cwd to read the global default only.
 */
export function getApprovalMode(cwd?: string): ApprovalMode {
  if (cwd) {
    const project = getProjectApprovalMode(cwd);
    if (project) return project;
  }
  return getGlobalApprovalMode();
}

/** Settings / IPC snapshot: effective + layers. */
export function getApprovalModeState(cwd?: string): ApprovalModeState {
  const global = getGlobalApprovalMode();
  const project = cwd ? (getProjectApprovalMode(cwd) ?? null) : null;
  return {
    global,
    project,
    effective: project ?? global,
  };
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
