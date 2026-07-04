import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;

vi.mock("electron", () => ({
  app: {
    getPath: () => userData,
  },
}));

const { getDatabase } = await import("../db/database");
const { browserRecentKey, listBrowserRecents, upsertBrowserRecent, deleteBrowserRecent } =
  await import("./browser-recents-store");

function insertWorkspace(workspaceId: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, `root-${workspaceId}`, "repo", 1, now, now);
}

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-browser-recents-test-"));
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

describe("browser-recents-store", () => {
  it("keys pages by URL without hash", () => {
    expect(browserRecentKey("https://example.com/a?x=1#top")).toBe("https://example.com/a?x=1");
    expect(browserRecentKey("about:blank")).toBeUndefined();
    expect(browserRecentKey("file:///tmp/a")).toBeUndefined();
  });

  it("upserts by workspace and URL key", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertWorkspace(workspaceId);

    upsertBrowserRecent({
      workspaceId,
      url: "https://example.com/page#one",
      title: "One",
    });
    upsertBrowserRecent({
      workspaceId,
      url: "https://example.com/page#two",
      title: "Two",
      favicon: "https://example.com/icon.png",
    });

    expect(listBrowserRecents(workspaceId)).toEqual([
      expect.objectContaining({
        workspaceId,
        url: "https://example.com/page#two",
        title: "Two",
        favicon: "https://example.com/icon.png",
      }),
    ]);
  });

  it("updates title and favicon without touching recency when requested", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertWorkspace(workspaceId);
    upsertBrowserRecent({ workspaceId, url: "https://example.com/first", title: "First" });
    upsertBrowserRecent({ workspaceId, url: "https://example.com/second", title: "Second" });
    const before = listBrowserRecents(workspaceId);

    upsertBrowserRecent({
      workspaceId,
      url: "https://example.com/first",
      title: "First updated",
      favicon: "https://example.com/icon.png",
      touch: false,
    });

    const after = listBrowserRecents(workspaceId);
    expect(after.map((recent) => recent.url)).toEqual(before.map((recent) => recent.url));
    expect(after.find((recent) => recent.url === "https://example.com/first")).toEqual(
      expect.objectContaining({
        title: "First updated",
        favicon: "https://example.com/icon.png",
      }),
    );
  });

  it("keeps only the latest 100 recents per workspace", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertWorkspace(workspaceId);

    for (let index = 0; index < 105; index += 1) {
      upsertBrowserRecent({
        workspaceId,
        url: `https://example.com/${index}`,
        title: `Page ${index}`,
      });
    }

    const recents = listBrowserRecents(workspaceId);
    expect(recents).toHaveLength(100);
    expect(recents.some((recent) => recent.url === "https://example.com/0")).toBe(false);
  });

  it("deletes a recent without touching the workspace", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertWorkspace(workspaceId);
    upsertBrowserRecent({ workspaceId, url: "https://example.com", title: "Example" });
    const recent = listBrowserRecents(workspaceId)[0];
    expect(recent).toBeDefined();

    deleteBrowserRecent(recent?.id ?? "");

    expect(listBrowserRecents(workspaceId)).toEqual([]);
  });
});
