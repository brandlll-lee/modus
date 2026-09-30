import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAgentSettings, readSettingsFile } from "./agent-settings";

/**
 * Layering behavior: the PI CLI's settings are the base, Modus overrides win,
 * and nothing on disk is written.
 *
 * `getAgentDir()` resolves from PI_CODING_AGENT_DIR, so pointing that at a
 * scratch directory exercises the real settings-file contract.
 */
const piAgentDir = mkdtempSync(join(tmpdir(), "modus-agent-settings-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = piAgentDir;

const settingsPath = join(piAgentDir, "settings.json");

afterAll(() => {
  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  rmSync(piAgentDir, { recursive: true, force: true });
});

describe("createAgentSettings", () => {
  it("inherits values declared by the PI CLI", () => {
    writeFileSync(settingsPath, JSON.stringify({ shellPath: "/usr/bin/fish", theme: "dark" }));

    const manager = createAgentSettings();

    expect(manager.getShellPath()).toBe("/usr/bin/fish");
    expect(manager.getTheme()).toBe("dark");
  });

  it("lets Modus overrides replace inherited values", () => {
    writeFileSync(settingsPath, JSON.stringify({ shellPath: "/usr/bin/fish" }));

    expect(createAgentSettings({ overrides: { shellPath: "/bin/bash" } }).getShellPath()).toBe(
      "/bin/bash",
    );
  });

  it("keeps inherited values the override does not mention", () => {
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

    expect(createAgentSettings({ overrides: { shellPath: "/bin/bash" } }).getTheme()).toBe("dark");
  });

  it("falls back to defaults when the CLI has no settings file", () => {
    rmSync(settingsPath, { force: true });

    expect(createAgentSettings().getShellPath()).toBeUndefined();
  });

  it("leaves the CLI's settings file byte-identical", () => {
    const original = `${JSON.stringify({ shellPath: "/usr/bin/fish" }, null, 2)}\n`;
    writeFileSync(settingsPath, original);

    createAgentSettings({ overrides: { shellPath: "/bin/bash", theme: "light" } });

    expect(readFileSync(settingsPath, "utf-8")).toBe(original);
  });
});

describe("readSettingsFile", () => {
  function write(name: string, content: string): string {
    const path = join(piAgentDir, name);
    writeFileSync(path, content, "utf-8");
    return path;
  }

  it("reads a settings document", () => {
    expect(readSettingsFile(write("ok.json", JSON.stringify({ theme: "dark" })))).toEqual({
      theme: "dark",
    });
  });

  it.each([
    ["malformed JSON", "{"],
    ["a JSON array", "[1,2]"],
    ["a JSON scalar", "42"],
  ])("treats %s as not configured", (_label, content) => {
    expect(readSettingsFile(write(`invalid-${content.length}.json`, content))).toEqual({});
  });

  it("treats an absent file as not configured", () => {
    expect(readSettingsFile(join(piAgentDir, "absent.json"))).toEqual({});
  });
});
