import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { listSkills, revealSkill } from "./skills-service";

const mocks = vi.hoisted(() => ({ resources: [] as unknown[], open: vi.fn(async () => "") }));
vi.mock("electron", () => ({ shell: { openPath: mocks.open } }));
vi.mock("../agent/session-resources", () => ({ sessionResources: () => mocks.resources }));
const root = mkdtempSync(join(tmpdir(), "modus-skill-view-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  mocks.resources = [];
  mocks.open.mockClear();
});
function resource(id: string, path: string) {
  return {
    id,
    cwd: root,
    loader: {
      getSkills: () => ({
        diagnostics: [],
        skills: [
          {
            name: id,
            description: "synthetic",
            filePath: path,
            sourceInfo: { scope: "user", source: "local" },
          },
        ],
      }),
    },
  };
}
it("uses the selected loader, not the first session in the workspace", () => {
  mocks.resources = [resource("other", "other-path"), resource("selected", "selected-path")];
  expect(listSkills("selected").skills.map((skill) => skill.path)).toEqual(["selected-path"]);
  expect(() => listSkills("closed")).toThrow("not loaded");
});
it("reveals existing discovered locations without changing their content", async () => {
  const path = join(root, "SKILL.md");
  writeFileSync(path, "synthetic contents");
  mocks.resources = [resource("selected", path)];
  await revealSkill("selected", path);
  expect(mocks.open).toHaveBeenCalledWith(root);
  expect(readFileSync(path, "utf8")).toBe("synthetic contents");
  await expect(revealSkill("selected", join(root, "absent"))).rejects.toThrow("not available");
});
