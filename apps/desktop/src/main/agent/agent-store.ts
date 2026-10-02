import { randomUUID } from "node:crypto";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSessionInfo } from "../../shared/contracts";
import { deriveSessionTitle } from "../../shared/session-title";
import { desktopPreferences, saveDesktopPreferences } from "../preferences/desktop-preferences";
import { listWorkspaces } from "../workspace/workspace-store";
import { sessionDirectory } from "./session-directory";

const sessions = new Map<string, AgentSessionInfo>();
const managers = new Map<string, SessionManager>();

export function sessionManagerFor(id: string): SessionManager | undefined {
  const current = managers.get(id);
  if (current) return current;
  const file = sessions.get(id)?.piSessionFile;
  return file ? openSessionFile(file) : undefined;
}

export function openSessionFile(file: string): SessionManager {
  if (!existsSync(file)) throw new Error(`Session file not found: ${file}`);
  if (!statSync(file).size) throw new Error(`Session file is empty: ${file}`);
  return SessionManager.open(file);
}

export function bindSessionManager(id: string, manager: SessionManager): void {
  managers.set(id, manager);
  const info = sessions.get(id);
  if (info) {
    info.piSessionId = manager.getSessionId();
    const file = manager.getSessionFile();
    if (file) info.piSessionFile = file;
  }
}

export function releaseSessionManager(id: string): void {
  managers.delete(id);
}

export function createAgentSessionRecord(input: {
  id?: string;
  workspaceId: string;
  title: string;
  cwd: string;
  runtime?: "pi-sdk";
  model?: string;
  piSessionId?: string;
  piSessionFile?: string;
}): AgentSessionInfo {
  const now = new Date().toISOString();
  const info: AgentSessionInfo = {
    ...input,
    id: input.id ?? randomUUID(),
    runtime: "pi-sdk",
    status: "starting",
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(info.id, info);
  return info;
}

export function getAgentSession(id: string): AgentSessionInfo | undefined {
  const memory = sessions.get(id);
  if (!memory) return undefined;
  const preference = desktopPreferences().sessions[memory.piSessionFile ?? ""] ?? {};
  let manager: SessionManager | undefined;
  try {
    manager = sessionManagerFor(id);
  } catch {
    const time = memory?.createdAt ?? "1970-01-01T00:00:00.000Z";
    return {
      id,
      workspaceId: memory.workspaceId,
      cwd: memory.cwd,
      title: memory?.title ?? basename(memory.piSessionFile ?? ""),
      status: "error",
      runtime: "pi-sdk",
      piSessionFile: memory.piSessionFile ?? "",
      createdAt: time,
      updatedAt: memory?.updatedAt ?? time,
      ...(preference.pinnedAt ? { pinnedAt: preference.pinnedAt } : {}),
      ...(preference.archivedAt ? { archivedAt: preference.archivedAt } : {}),
    };
  }
  if (!manager) return undefined;
  const header = manager.getHeader();
  const branch = manager.getBranch();
  const first = branch.find((entry) => entry.type === "message" && entry.message.role === "user");
  const text =
    first?.type === "message" && first.message.role === "user"
      ? typeof first.message.content === "string"
        ? first.message.content
        : first.message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
      : "";
  const context = manager.buildSessionContext();
  const model = context.model
    ? `${context.model.provider}/${context.model.modelId}`
    : memory?.model;
  const info: AgentSessionInfo = {
    id,
    workspaceId: memory.workspaceId,
    cwd: manager.getCwd(),
    title: manager.getSessionName() || memory?.title || deriveSessionTitle(text),
    status: memory?.status ?? "idle",
    runtime: "pi-sdk",
    piSessionId: manager.getSessionId(),
    piSessionFile: memory.piSessionFile ?? "",
    createdAt:
      header?.timestamp ??
      memory?.createdAt ??
      statSync(memory.piSessionFile ?? "").birthtime.toISOString(),
    updatedAt:
      branch.at(-1)?.timestamp ??
      memory?.updatedAt ??
      header?.timestamp ??
      statSync(memory.piSessionFile ?? "").mtime.toISOString(),
    ...(model ? { model } : {}),
    ...(preference.pinnedAt ? { pinnedAt: preference.pinnedAt } : {}),
    ...(preference.archivedAt ? { archivedAt: preference.archivedAt } : {}),
  };
  sessions.set(id, info);
  return info;
}

export async function discoverAgentSessions(): Promise<void> {
  await Promise.all(
    listWorkspaces().map(async (workspace) => {
      const entries = await SessionManager.list(
        workspace.rootPath,
        sessionDirectory(workspace.rootPath),
      );
      for (const entry of entries) {
        if ([...sessions.values()].some((info) => info.piSessionFile === entry.path)) continue;
        sessions.set(entry.id, {
          id: entry.id,
          workspaceId: workspace.id,
          cwd: entry.cwd,
          title: entry.name || deriveSessionTitle(entry.firstMessage),
          runtime: "pi-sdk",
          status: "idle",
          piSessionId: entry.id,
          piSessionFile: entry.path,
          createdAt: entry.created.toISOString(),
          updatedAt: entry.modified.toISOString(),
        });
      }
    }),
  );
}

export function touchAgentSession(id: string): string {
  const time = new Date().toISOString();
  const info = getAgentSession(id);
  if (info) sessions.set(id, { ...info, updatedAt: time });
  return time;
}

export function updateAgentSessionStatus(id: string, status: AgentSessionInfo["status"]): void {
  const info = sessions.get(id) ?? getAgentSession(id);
  if (info) sessions.set(id, { ...info, status });
}

export function updateAgentSessionMetadata(
  id: string,
  metadata: Partial<Pick<AgentSessionInfo, "model" | "piSessionId" | "piSessionFile">>,
): AgentSessionInfo | undefined {
  const info = getAgentSession(id);
  if (!info) return undefined;
  const next = { ...info, ...metadata };
  sessions.set(id, next);
  return next;
}

export function updateAgentSessionTitle(id: string, title: string): AgentSessionInfo | undefined {
  const info = getAgentSession(id);
  if (!info) return undefined;
  sessionManagerFor(id)?.appendSessionInfo(title);
  const next = { ...info, title };
  sessions.set(id, next);
  return next;
}

export function listAgentSessions(options: { includeSessionId?: string } = {}): AgentSessionInfo[] {
  const workspaceIds = new Set(listWorkspaces().map((item) => item.id));
  return [...sessions.keys()]
    .map(getAgentSession)
    .filter(
      (item): item is AgentSessionInfo =>
        Boolean(item) &&
        workspaceIds.has(item?.workspaceId ?? "") &&
        (!item?.archivedAt || item.id === options.includeSessionId),
    )
    .sort(
      (a, b) =>
        (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "") ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

export function listArchivedAgentSessions(workspaceId: string): AgentSessionInfo[] {
  return [...sessions.keys()]
    .map(getAgentSession)
    .filter(
      (item): item is AgentSessionInfo =>
        Boolean(item) && item?.workspaceId === workspaceId && Boolean(item.archivedAt),
    );
}

export function setAgentSessionPinned(id: string, pinned: boolean): AgentSessionInfo | undefined {
  const file = getAgentSession(id)?.piSessionFile;
  if (!file) return undefined;
  const preferences = desktopPreferences();
  const preference = preferences.sessions[file] ?? {};
  if (pinned) preference.pinnedAt = new Date().toISOString();
  else delete preference.pinnedAt;
  preferences.sessions[file] = preference;
  saveDesktopPreferences();
  return getAgentSession(id);
}

export function setAgentSessionArchived(
  id: string,
  archived: boolean,
): AgentSessionInfo | undefined {
  const file = getAgentSession(id)?.piSessionFile;
  if (!file) return undefined;
  const preferences = desktopPreferences();
  const preference = preferences.sessions[file] ?? {};
  if (archived) preference.archivedAt = new Date().toISOString();
  else delete preference.archivedAt;
  preferences.sessions[file] = preference;
  saveDesktopPreferences();
  return getAgentSession(id);
}

export function deleteAgentSession(id: string): void {
  const info = getAgentSession(id);
  if (info?.piSessionFile && existsSync(info.piSessionFile)) unlinkSync(info.piSessionFile);
  if (info?.piSessionFile) {
    delete desktopPreferences().sessions[info.piSessionFile];
    saveDesktopPreferences();
  }
  managers.delete(id);
  sessions.delete(id);
}
