import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultMcpConfigPath,
  findRawMcpEntry,
  loadWorkspaceMcpConfig,
  removeMcpServerEntry,
  setMcpServerEnabledEntry,
  upsertMcpServerEntry,
  userMcpConfigPath,
} from "./mcp-config";

const roots = vi.hoisted(() => ({ home: "", cli: "" }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => roots.home,
}));
vi.mock("../agent/agent-paths", () => ({ getPiCliAgentDir: () => roots.cli }));
let root: string;
let cwd: string;
function save(path: string, mcpServers: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ mcpServers }), "utf8");
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-mcp-"));
  cwd = join(root, "workspace");
  roots.home = join(root, "home");
  roots.cli = join(root, "cli");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("MCP configuration ownership", () => {
  it("gates project files on native trust and preserves native server fields", () => {
    save(join(roots.cli, "mcp.json"), {
      inherited: {
        command: "fixture",
        env: { TOKEN: `\${TOKEN}` },
        timeout: 1234,
        exposure: "deferred",
      },
    });
    save(join(cwd, ".pi", "mcp.json"), { project: { url: "https://example.test/mcp" } });
    save(userMcpConfigPath(), { own: { command: "own" } });
    save(defaultMcpConfigPath(cwd), { scoped: { command: "scoped" } });
    expect(loadWorkspaceMcpConfig(cwd).servers.map((entry) => entry.name)).toEqual([
      "inherited",
      "own",
    ]);
    expect(loadWorkspaceMcpConfig(cwd, { projectTrusted: true }).servers).toHaveLength(4);
    expect(findRawMcpEntry(cwd, "inherited")?.entry).toMatchObject({
      timeout: 1234,
      env: { TOKEN: `\${TOKEN}` },
      exposure: "deferred",
    });
  });
  it("writes inherited edits to Modus and masks the old name on rename", () => {
    const inheritedPath = join(cwd, ".pi", "mcp.json");
    save(inheritedPath, {
      source: { command: "fixture", exposure: "deferred", toolExposure: { inspect: "direct" } },
    });
    const before = readFileSync(inheritedPath, "utf8");
    upsertMcpServerEntry(cwd, {
      name: "renamed",
      originalName: "source",
      transport: "http",
      url: "https://example.test/mcp",
      enabled: true,
    });
    expect(readFileSync(inheritedPath, "utf8")).toBe(before);
    expect(findRawMcpEntry(cwd, "source")?.entry.enabled).toBe(false);
    expect(findRawMcpEntry(cwd, "renamed")?.entry).toMatchObject({
      exposure: "deferred",
      toolExposure: { inspect: "direct" },
      url: "https://example.test/mcp",
    });
    expect(findRawMcpEntry(cwd, "renamed")?.entry.command).toBeUndefined();
  });
  it("disables inherited entries without modifying their file", () => {
    const path = join(roots.cli, "mcp.json");
    save(path, { remote: { url: "https://example.test/mcp" } });
    const before = readFileSync(path, "utf8");
    setMcpServerEnabledEntry(cwd, "remote", false);
    expect(findRawMcpEntry(cwd, "remote")?.entry.enabled).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
    removeMcpServerEntry(cwd, "remote");
    expect(findRawMcpEntry(cwd, "remote")?.source).toBe(path);
  });
  it("writes global servers only to the Modus user directory", () => {
    upsertMcpServerEntry(cwd, {
      name: "global",
      scope: "user",
      transport: "stdio",
      command: "fixture",
      enabled: true,
    });
    expect(findRawMcpEntry(cwd, "global")?.source).toBe(userMcpConfigPath());
  });
  it("reports malformed files while retaining valid configuration", () => {
    save(userMcpConfigPath(), { valid: { command: "fixture" } });
    mkdirSync(dirname(defaultMcpConfigPath(cwd)), { recursive: true });
    writeFileSync(defaultMcpConfigPath(cwd), "{", "utf8");
    const result = loadWorkspaceMcpConfig(cwd, { projectTrusted: true });
    expect(result.servers.map((entry) => entry.name)).toEqual(["valid"]);
    expect(result.errors).toHaveLength(1);
  });
});
