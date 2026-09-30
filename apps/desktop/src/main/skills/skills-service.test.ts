import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onSessionResourcesChanged,
  registerSessionResources,
  releaseSessionResources,
} from "../agent/session-resources";
import { createSkill, getSkill, listSkills, skillPathsFor } from "./skills-service";

vi.mock("../agent/project-trust", () => ({ resolveProjectTrust: async () => true }));
vi.mock("../agent/agent-paths", () => ({ modusAgentDir: () => agentDir }));
let cwd: string;
let agentDir: string;
let bundled: string;
const ids: string[] = [];
async function load(cwdPath = cwd): Promise<void> {
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
  const loader = new DefaultResourceLoader({
    cwd: cwdPath,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: [bundled, join(cwdPath, ".modus", "skills")],
  });
  await loader.reload();
  const id = crypto.randomUUID();
  ids.push(id);
  registerSessionResources({
    id,
    cwd: cwdPath,
    loader,
    session: {
      isStreaming: false,
      settingsManager,
      reload: () => loader.reload(),
    } as unknown as AgentSession,
  });
}
function writeSkill(root: string, name: string, extra = ""): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(file, `---\nname: ${name}\ndescription: Review code\n${extra}---\nBODY`, "utf8");
  return file;
}
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "modus-skills-"));
  agentDir = join(cwd, "agent");
  bundled = join(cwd, "bundled");
  writeSkill(bundled, "browser");
});
afterEach(() => {
  for (const id of ids.splice(0)) releaseSessionResources(id);
  rmSync(cwd, { recursive: true, force: true });
});

describe("session skills", () => {
  it("is empty before initialization and reflects native metadata after loading", async () => {
    expect(listSkills(cwd)).toEqual([]);
    await load();
    expect(listSkills(cwd).find((skill) => skill.name === "browser")).toMatchObject({
      scope: "temporary",
      enabled: true,
    });
  });
  it("keeps workspaces isolated and returns only discovered files", async () => {
    const file = writeSkill(join(cwd, ".pi", "skills"), "review");
    await load();
    expect(listSkills(cwd).find((skill) => skill.name === "review")?.scope).toBe("project");
    expect(getSkill(cwd, file)?.body).toContain("BODY");
    expect(getSkill(join(cwd, "other"), file)).toBeUndefined();
    expect(getSkill(cwd, join(cwd, "undiscovered.md"))).toBeUndefined();
  });
  it("preserves the native model invocation flag", async () => {
    writeSkill(join(cwd, ".pi", "skills"), "manual", "disable-model-invocation: true\n");
    await load();
    expect(listSkills(cwd).find((skill) => skill.name === "manual")?.allowImplicitInvocation).toBe(
      false,
    );
  });
  it("creates a native skill and refreshes open session resources", async () => {
    await load();
    const changed = vi.fn();
    const unsubscribe = onSessionResourcesChanged(changed);
    try {
      const created = await createSkill({
        cwd,
        name: "Code Review",
        description: 'Review: "changes"',
        body: "Read the diff.",
      });
      expect(readFileSync(created.path, "utf8")).toContain("name: code-review");
      expect(listSkills(cwd).find((skill) => skill.name === "code-review")?.description).toBe(
        'Review: "changes"',
      );
      expect(changed).toHaveBeenCalledWith(cwd);
      await expect(
        createSkill({ cwd, name: "Code Review", description: "Duplicate", body: "BODY" }),
      ).rejects.toThrow(/already exists/);
    } finally {
      unsubscribe();
    }
  });
  it("contributes Modus-owned paths", () => {
    expect(skillPathsFor(cwd)).toContain(join(cwd, ".modus", "skills"));
    expect(skillPathsFor(cwd)).toContain(join(homedir(), ".modus", "skills"));
  });
});
