import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => paths.root } }));
vi.mock("../agent/session-directory", () => ({
  sessionDirectory: () => join(paths.root, "native"),
}));

beforeEach(() => {
  vi.resetModules();
  paths.root = mkdtempSync(join(tmpdir(), "modus-import-"));
});
afterEach(() => rmSync(paths.root, { recursive: true, force: true }));

function fixture() {
  const manager = SessionManager.create(paths.root, join(paths.root, "private"));
  const entryId = manager.appendMessage({
    role: "user",
    content: "Question",
    timestamp: Date.now(),
  });
  manager.appendMessage(fauxAssistantMessage("Saved answer"));
  const file = manager.getSessionFile() as string;
  const db = new DatabaseSync(join(paths.root, "modus.sqlite"));
  db.exec(
    "create table workspaces(id text,root_path text,display_name text,is_git_repository integer,last_opened_at text,pinned integer,pinned_at text);create table agent_sessions(id text,workspace_id text,cwd text,title text,pi_session_file text,pinned_at text,archived_at text);create table agent_events(id text,session_id text,payload_json text);",
  );
  db.prepare("insert into workspaces values(?,?,?,?,?,?,?)").run(
    "workspace",
    paths.root,
    "Project",
    0,
    new Date().toISOString(),
    0,
    null,
  );
  db.prepare("insert into agent_sessions values(?,?,?,?,?,?,?)").run(
    "desktop-id",
    "workspace",
    paths.root,
    "Title",
    file,
    "2026-10-01",
    null,
  );
  db.prepare("insert into agent_events values(?,?,?)").run(
    "start",
    "desktop-id",
    JSON.stringify({
      type: "message.started",
      sessionId: "desktop-id",
      messageId: "image-user",
      role: "user",
      attachments: [
        {
          type: "image",
          path: join(paths.root, "image.png"),
          mimeType: "image/png",
          data: "pixels",
        },
      ],
    }),
  );
  db.prepare("insert into agent_events values(?,?,?)").run(
    "text",
    "desktop-id",
    JSON.stringify({
      type: "message.delta",
      sessionId: "desktop-id",
      messageId: "image-user",
      delta: "Question",
    }),
  );
  db.close();
  return { file, entryId };
}

it("imports native history and GUI image metadata, then removes the active database", async () => {
  const { file, entryId } = fixture();
  const { importDesktopData } = await import("./import-desktop-data");
  importDesktopData();
  importDesktopData();
  const destination = join(paths.root, "native", basename(file));
  expect(existsSync(file)).toBe(false);
  expect(existsSync(join(paths.root, "modus.sqlite"))).toBe(false);
  expect(existsSync(join(paths.root, "data-import-source.sqlite"))).toBe(true);
  const manager = SessionManager.open(destination);
  expect(manager.getSessionName()).toBe("Title");
  expect(manager.getEntries()).toContainEqual(
    expect.objectContaining({
      type: "custom",
      customType: "modus.message",
      data: expect.objectContaining({
        entryId,
        messageId: "image-user",
        attachments: [{ path: join(paths.root, "image.png"), mimeType: "image/png" }],
      }),
    }),
  );
  expect(JSON.stringify(manager.buildSessionContext().messages)).toContain("Saved answer");
  expect(JSON.stringify(manager.buildSessionContext().messages)).not.toContain("image-user");
  const preferences = JSON.parse(
    readFileSync(join(paths.root, "desktop-preferences.json"), "utf8"),
  );
  expect(preferences.sessions[destination]).toEqual({ pinnedAt: "2026-10-01" });
  const { discoverAgentSessions, listAgentSessions } = await import("../agent/agent-store");
  await discoverAgentSessions();
  expect(listAgentSessions()).toContainEqual(
    expect.objectContaining({ id: manager.getSessionId(), piSessionFile: destination }),
  );
});

it("keeps both session files and the source database when the destination conflicts", async () => {
  const { file } = fixture();
  mkdirSync(join(paths.root, "native"));
  const destination = join(paths.root, "native", basename(file));
  copyFileSync(file, destination);
  const original = readFileSync(file, "utf8");
  const { importDesktopData } = await import("./import-desktop-data");
  expect(importDesktopData).toThrow("already exists");
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(readFileSync(destination, "utf8")).toBe(original);
  expect(existsSync(join(paths.root, "modus.sqlite"))).toBe(true);
});

it("preserves a record with a missing native file in the import archive", async () => {
  const { file } = fixture();
  unlinkSync(file);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { importDesktopData } = await import("./import-desktop-data");
    importDesktopData();
    expect(existsSync(join(paths.root, "modus.sqlite"))).toBe(false);
    const archive = new DatabaseSync(join(paths.root, "data-import-source.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        archive.prepare("select pi_session_file from agent_sessions").get()?.pi_session_file,
      ).toBe(file);
    } finally {
      archive.close();
    }
    expect(await SessionManager.list(paths.root, join(paths.root, "native"))).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Session file not found"));
  } finally {
    warning.mockRestore();
  }
});
