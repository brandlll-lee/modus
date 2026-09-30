import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createAgentSettings } from "./agent-settings";

const root = mkdtempSync(join(tmpdir(), "modus-agent-settings-"));
vi.mock("./agent-paths", () => ({
  getPiCliAgentDir: () => root,
  modusAgentDir: () => join(root, "product"),
}));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
const path = join(root, "settings.json");

afterAll(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

describe("PI settings inheritance", () => {
  it("retains nested inherited values and host overrides across reload", async () => {
    writeFileSync(
      path,
      JSON.stringify({
        shellPath: "inherited-shell",
        compaction: { enabled: true, reserveTokens: 4096 },
      }),
    );
    const settings = createAgentSettings({
      overrides: { shellPath: "host-shell", compaction: { enabled: false } },
    });
    await settings.reload();
    expect(settings.getShellPath()).toBe("host-shell");
    expect(settings.getCompactionSettings()).toMatchObject({ enabled: false, reserveTokens: 4096 });
  });

  it("reads project settings only when project trust is granted", async () => {
    const cwd = join(root, "project");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(path, JSON.stringify({ shellPath: "global-shell" }));
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ shellPath: "project-shell" }),
    );
    expect(createAgentSettings({ cwd }).getShellPath()).toBe("global-shell");
    const settings = createAgentSettings({ cwd, projectTrusted: true });
    await settings.reload();
    expect(settings.getShellPath()).toBe("project-shell");
  });

  it("keeps CLI files byte-identical while changing effective settings", async () => {
    const original = `${JSON.stringify({ shellPath: "cli-shell" }, null, 2)}\n`;
    writeFileSync(path, original);
    const settings = createAgentSettings({ overrides: { shellPath: "host-shell" } });
    settings.setTheme("light");
    await settings.flush();
    await settings.reload();
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("applies both directories in trust-aware order and rereads external edits", async () => {
    const cwd = join(root, "layered");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mkdirSync(join(cwd, ".modus"), { recursive: true });
    mkdirSync(join(root, "product"), { recursive: true });
    writeFileSync(path, JSON.stringify({ shellPath: "pi-global" }));
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ shellPath: "pi-project" }));
    writeFileSync(
      join(root, "product", "settings.json"),
      JSON.stringify({ shellPath: "modus-global" }),
    );
    const project = join(cwd, ".modus", "settings.json");
    writeFileSync(project, JSON.stringify({ shellPath: "modus-project" }));
    expect(createAgentSettings({ cwd }).getShellPath()).toBe("modus-global");
    const trusted = createAgentSettings({ cwd, projectTrusted: true });
    expect(trusted.getShellPath()).toBe("modus-project");
    writeFileSync(project, JSON.stringify({ shellPath: "external-change" }));
    await trusted.reload();
    expect(trusted.getShellPath()).toBe("external-change");
    rmSync(project);
    await trusted.reload();
    expect(trusted.getShellPath()).toBe("modus-global");
    rmSync(join(root, "product", "settings.json"));
  });

  it("uses PI defaults when the settings file is absent", () => {
    rmSync(path, { force: true });
    expect(createAgentSettings().getShellPath()).toBeUndefined();
  });
});
