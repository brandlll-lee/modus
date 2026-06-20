import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPersonalization,
  resolveGlobalGuidancePrompt,
  savePersonalization,
} from "./guidance-service";

describe("guidance-service", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "modus-guidance-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers AGENTS.override.md when it has content", () => {
    writeFileSync(join(root, "AGENTS.md"), "base guidance", "utf8");
    writeFileSync(join(root, "AGENTS.override.md"), "override guidance", "utf8");

    const state = getPersonalization(root);

    expect(state.overrideActive).toBe(true);
    expect(state.content).toBe("override guidance");
    expect(resolveGlobalGuidancePrompt(root)).toContain("override guidance");
    expect(resolveGlobalGuidancePrompt(root)).not.toContain("base guidance");
  });

  it("ignores empty guidance", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), " \n\t ", "utf8");

    expect(resolveGlobalGuidancePrompt(root)).toBeUndefined();
  });

  it("caps injected guidance by bytes", () => {
    writeFileSync(join(root, "AGENTS.md"), "好".repeat(30 * 1024), "utf8");

    const prompt = resolveGlobalGuidancePrompt(root) ?? "";

    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(26 * 1024);
    expect(prompt).toContain("global guidance truncated");
  });

  it("saves to AGENTS.md unless an override is active", () => {
    expect(savePersonalization("base", root)).toMatchObject({
      activePath: join(root, "AGENTS.md"),
      content: "base",
      overrideActive: false,
    });

    writeFileSync(join(root, "AGENTS.override.md"), "override", "utf8");

    expect(savePersonalization("next override", root)).toMatchObject({
      activePath: join(root, "AGENTS.override.md"),
      content: "next override",
      overrideActive: true,
    });
  });
});
