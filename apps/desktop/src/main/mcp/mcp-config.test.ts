import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadWorkspaceMcpConfig } from "./mcp-config";

const roots = vi.hoisted(() => ({ home: "", cli: "" }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => roots.home,
}));
vi.mock("../agent/agent-paths", () => ({ getPiCliAgentDir: () => roots.cli }));
let root: string, cwd: string;
function save(path: string, mcpServers: Record<string, unknown>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ mcpServers }));
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-mcp-"));
  cwd = join(root, "project");
  roots.home = join(root, "home");
  roots.cli = join(root, "cli");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("gates project configuration and preserves native fields and source paths", () => {
  const inherited = join(roots.cli, "mcp.json");
  save(inherited, { synthetic: { command: "fixture", exposure: "deferred", timeout: 1234 } });
  save(join(cwd, ".pi", "mcp.json"), { project: { command: "fixture" } });
  const before = readFileSync(inherited, "utf8");
  expect(loadWorkspaceMcpConfig(cwd).servers).toEqual([
    {
      name: "synthetic",
      source: inherited,
      scope: "global",
      config: { command: "fixture", exposure: "deferred", timeout: 1234 },
    },
  ]);
  expect(loadWorkspaceMcpConfig(cwd, { projectTrusted: true }).servers).toHaveLength(2);
  expect(readFileSync(inherited, "utf8")).toBe(before);
});
it("replaces whole server entries in product priority order", () => {
  save(join(roots.cli, "mcp.json"), {
    synthetic: { command: "first", env: { PRIVATE: "source" } },
  });
  save(join(cwd, ".pi", "mcp.json"), { synthetic: { command: "second" } });
  save(join(roots.home, ".modus", "agent", "mcp.json"), {
    synthetic: { url: "https://example.test/mcp" },
  });
  expect(loadWorkspaceMcpConfig(cwd, { projectTrusted: true }).servers[0]?.config).toEqual({
    url: "https://example.test/mcp",
  });
  save(join(cwd, ".modus", "mcp.json"), { synthetic: { command: "final", enabled: false } });
  expect(loadWorkspaceMcpConfig(cwd, { projectTrusted: true }).servers[0]?.config).toEqual({
    command: "final",
    enabled: false,
  });
});
it("reports malformed files without discarding valid entries", () => {
  save(join(roots.cli, "mcp.json"), { valid: { command: "fixture" } });
  const path = join(cwd, ".modus", "mcp.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "{");
  const result = loadWorkspaceMcpConfig(cwd, { projectTrusted: true });
  expect(result.servers).toHaveLength(1);
  expect(result.errors).toHaveLength(1);
});
