import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => paths.root } }));
afterEach(() => rmSync(paths.root, { recursive: true, force: true }));
it("persists supported session preferences and preserves project shortcuts", async () => {
  vi.resetModules();
  paths.root = mkdtempSync(join(tmpdir(), "modus-preferences-"));
  const file = join(paths.root, "desktop-preferences.json");
  writeFileSync(
    file,
    JSON.stringify({
      workspaces: [{ id: "workspace" }],
      browserRecents: [],
      sessions: { selected: { pinnedAt: "2026-10-01", extra: "value" }, other: { extra: "value" } },
    }),
  );
  const { desktopPreferences } = await import("./desktop-preferences");
  expect(desktopPreferences().sessions).toEqual({ selected: { pinnedAt: "2026-10-01" } });
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
    workspaces: [{ id: "workspace" }],
    browserRecents: [],
    sessions: { selected: { pinnedAt: "2026-10-01" } },
  });
});
