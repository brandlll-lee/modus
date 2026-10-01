import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "modus-pi-settings-"));
vi.mock("./agent-paths", () => ({ getPiCliAgentDir: () => root }));

import { createAgentSettings } from "./agent-settings";

afterAll(() => rmSync(root, { recursive: true, force: true }));

it("shares native settings, persistence, trust and reload semantics", async () => {
  const cwd = join(root, "workspace");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const global = join(root, "settings.json");
  const project = join(cwd, ".pi", "settings.json");
  writeFileSync(
    global,
    JSON.stringify({ defaultTools: ["read"], compaction: { reserveTokens: 4096 } }),
  );
  writeFileSync(project, JSON.stringify({ defaultTools: ["read", "grep"] }));
  for (const projectTrusted of [false, true]) {
    const desktop = createAgentSettings({ cwd, projectTrusted });
    const native = SettingsManager.create(cwd, root, { projectTrusted });
    expect(desktop.getSettings()).toEqual(native.getSettings());
  }
  const desktop = createAgentSettings({ cwd });
  desktop.setDefaultModelAndProvider("fixture", "model");
  await desktop.flush();
  expect(JSON.parse(readFileSync(global, "utf8"))).toMatchObject({
    defaultProvider: "fixture",
    defaultModel: "model",
  });
  writeFileSync(project, JSON.stringify({ defaultTools: ["find"] }));
  desktop.setProjectTrusted(true);
  await desktop.reload();
  expect(desktop.getDefaultTools()).toEqual(["find"]);
});
