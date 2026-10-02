import { constants, copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import type { AgentEvent, BrowserRecentInfo, WorkspaceInfo } from "../../shared/contracts";
import { messagePresentations } from "../agent/agent-history";
import { openSessionFile } from "../agent/agent-store";
import { sessionDirectory } from "../agent/session-directory";
import { desktopPreferences, saveDesktopPreferences } from "./desktop-preferences";

export function importDesktopData(): void {
  const source = join(app.getPath("userData"), "modus.sqlite");
  if (!existsSync(source)) return;
  const db = new DatabaseSync(source, { readOnly: true });
  const backup = join(app.getPath("userData"), "data-import-source.sqlite");
  try {
    if (!existsSync(backup)) db.prepare("vacuum into ?").run(backup);
    const hasTable = (name: string) =>
      Boolean(db.prepare("select name from sqlite_master where type='table' and name=?").get(name));
    const preferences = desktopPreferences();
    if (hasTable("workspaces")) {
      const rows = db.prepare("select * from workspaces").all();
      for (const row of rows) {
        if (preferences.workspaces.some((workspace) => workspace.id === row.id)) continue;
        preferences.workspaces.push({
          id: row.id,
          rootPath: row.root_path,
          displayName: row.display_name,
          isGitRepository: row.is_git_repository === 1,
          lastOpenedAt: row.last_opened_at,
          pinned: row.pinned === 1,
          ...(row.pinned_at ? { pinnedAt: row.pinned_at } : {}),
        } as WorkspaceInfo);
      }
    }
    if (hasTable("browser_recents")) {
      for (const row of db
        .prepare("select * from browser_recents order by last_opened_at desc, rowid desc")
        .all()) {
        if (preferences.browserRecents.some((recent) => recent.id === row.id)) continue;
        preferences.browserRecents.push({
          id: row.id,
          workspaceId: row.workspace_id,
          url: row.url,
          title: row.title,
          createdAt: row.created_at,
          lastOpenedAt: row.last_opened_at,
          ...(row.favicon ? { favicon: row.favicon } : {}),
        } as BrowserRecentInfo);
      }
    }
    if (hasTable("agent_sessions")) {
      for (const row of db.prepare("select * from agent_sessions").all()) {
        if (typeof row.pi_session_file !== "string") continue;
        const cwd = String(row.cwd);
        const directory = SessionManager.create(cwd, sessionDirectory(cwd)).getSessionDir();
        const destination = join(directory, basename(row.pi_session_file));
        const file = existsSync(row.pi_session_file) ? row.pi_session_file : destination;
        if (relative(file, destination) && existsSync(destination))
          throw new Error(`Session destination already exists: ${destination}`);
        if (!existsSync(file)) {
          console.warn(
            `Session file not found: ${row.pi_session_file}. Record preserved in ${backup}.`,
          );
          continue;
        }
        const manager = openSessionFile(file);
        if (!manager.getSessionName() && row.title && row.title !== "New chat")
          manager.appendSessionInfo(String(row.title));
        if (hasTable("agent_events")) {
          const events = db
            .prepare("select payload_json from agent_events where session_id=? order by rowid")
            .all(String(row.id)) as { payload_json: string }[];
          const messages = new Map<
            string,
            { text: string; start: Extract<AgentEvent, { type: "message.started" }> }
          >();
          for (const stored of events) {
            const event = JSON.parse(stored.payload_json) as AgentEvent;
            if (event.type === "message.started" && event.role === "user")
              messages.set(event.messageId, { text: "", start: event });
            if (event.type === "message.delta") {
              const message = messages.get(event.messageId);
              if (message) message.text += event.delta;
            }
          }
          const presentations = messagePresentations(manager);
          const entries = manager
            .getEntries()
            .filter((entry) => entry.type === "message" && entry.message.role === "user");
          for (const { text, start } of messages.values()) {
            const entry = entries.find((item) => {
              if (
                item.type !== "message" ||
                item.message.role !== "user" ||
                presentations.has(item.id)
              )
                return false;
              const content =
                typeof item.message.content === "string"
                  ? item.message.content
                  : item.message.content
                      .filter((part) => part.type === "text")
                      .map((part) => part.text)
                      .join("\n");
              return content === text || Boolean(text && content.endsWith(`\n\n${text}`));
            });
            if (!entry) continue;
            const data = {
              entryId: entry.id,
              messageId: start.messageId,
              text,
              ...(start.contextItems ? { paths: start.contextItems.map((item) => item.path) } : {}),
              ...(start.skills ? { skills: start.skills } : {}),
              ...(start.attachments
                ? {
                    attachments: start.attachments
                      .filter((image) => image.path)
                      .map((image) => ({
                        path: image.path!,
                        mimeType: image.mimeType,
                        ...(image.name ? { name: image.name } : {}),
                      })),
                  }
                : {}),
            };
            manager.appendCustomEntry("modus.message", data);
            presentations.set(entry.id, data);
          }
        }
        if (relative(file, destination)) {
          mkdirSync(directory, { recursive: true });
          if (existsSync(destination))
            throw new Error(`Session destination already exists: ${destination}`);
          try {
            renameSync(file, destination);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
            copyFileSync(file, destination, constants.COPYFILE_EXCL);
            unlinkSync(file);
          }
        }
        preferences.sessions[destination] = {
          ...(row.pinned_at ? { pinnedAt: String(row.pinned_at) } : {}),
          ...(row.archived_at ? { archivedAt: String(row.archived_at) } : {}),
        };
      }
    }
    saveDesktopPreferences();
  } finally {
    db.close();
  }
  unlinkSync(source);
  for (const suffix of ["-wal", "-shm"])
    if (existsSync(`${source}${suffix}`)) unlinkSync(`${source}${suffix}`);
}
