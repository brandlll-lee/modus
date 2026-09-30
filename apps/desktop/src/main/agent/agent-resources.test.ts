import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ cli: "", product: "" }));
vi.mock("./agent-paths", () => ({
  getPiCliAgentDir: () => paths.cli,
  modusAgentDir: () => paths.product,
}));

import { createAgentResourceLoader } from "./agent-resources";
import { createAgentSettings } from "./agent-settings";

let root: string;
let cwd: string;
function put(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
function skill(base: string, description: string) {
  put(
    join(base, "skills", "synthetic", "SKILL.md"),
    `---\nname: synthetic\ndescription: ${description}\n---\nSynthetic instructions.\n`,
  );
}
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "modus-resources-"));
  cwd = join(root, "workspace");
  paths.cli = join(root, "cli");
  paths.product = join(root, "product");
  skill(paths.cli, "PI user");
  skill(paths.product, "Modus user");
  skill(join(cwd, ".modus"), "Modus project");
  put(join(cwd, "AGENTS.md"), "SYNTHETIC_SHARED_CONTEXT");
  put(join(paths.cli, "AGENTS.md"), "SYNTHETIC_CLI_CONTEXT");
  put(join(paths.product, "AGENTS.md"), "SYNTHETIC_PRODUCT_CONTEXT");
  put(join(cwd, ".modus", "AGENTS.md"), "SYNTHETIC_PROJECT_CONTEXT");
  put(
    join(cwd, ".modus", "extensions", "synthetic.ts"),
    'export default function(pi) {pi.registerCommand("synthetic-command", {description: "Synthetic", handler: async () => {}}); }',
  );
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
it("applies native discovery, project trust and external edits on the same session loader", async () => {
  const settings = createAgentSettings({
    cwd,
    projectTrusted: false,
    overrides: { packages: [], extensions: [], skills: [], prompts: [], themes: [] },
  });
  const loader = await createAgentResourceLoader(cwd, settings, [
    { name: "codemode", factory: createCodemodeExtension() },
    { name: "tool_search", factory: createToolSearchExtension() },
    {
      name: "mcp",
      factory: createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) }),
    },
  ]);
  expect(loader.getSkills().skills.find((entry) => entry.name === "synthetic")?.description).toBe(
    "Modus user",
  );
  expect(
    loader.getExtensions().extensions.some((entry) => entry.path.endsWith("synthetic.ts")),
  ).toBe(false);
  settings.setProjectTrusted(true);
  await loader.reload();
  expect(loader.getSkills().skills.find((entry) => entry.name === "synthetic")?.description).toBe(
    "Modus project",
  );
  expect(
    loader.getExtensions().extensions.some((entry) => entry.path.endsWith("synthetic.ts")),
  ).toBe(true);
  const instructions = loader
    .getAgentsFiles()
    .agentsFiles.map((entry) => entry.content)
    .join("\n");
  expect(instructions.split("SYNTHETIC_SHARED_CONTEXT")).toHaveLength(2);
  expect(instructions).toContain("SYNTHETIC_CLI_CONTEXT");
  expect(instructions).toContain("SYNTHETIC_PRODUCT_CONTEXT");
  expect(instructions).toContain("SYNTHETIC_PROJECT_CONTEXT");
  skill(join(cwd, ".modus"), "Changed externally");
  await loader.reload();
  expect(loader.getSkills().skills.find((entry) => entry.name === "synthetic")?.description).toBe(
    "Changed externally",
  );
  settings.setProjectTrusted(false);
  await loader.reload();
  expect(loader.getSkills().skills.find((entry) => entry.name === "synthetic")?.description).toBe(
    "Modus user",
  );
});
