import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ root: "", home: "" }));
vi.mock("electron", () => ({ app: { getPath: () => paths.root } }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => paths.home,
}));
vi.mock("./agent-paths", () => ({ modusAgentDir: () => join(paths.home, ".modus", "agent") }));

import { migrateAgentConfiguration } from "./configuration-migration";

let database: DatabaseSync;
beforeEach(() => {
  paths.root = mkdtempSync(join(tmpdir(), "modus-migration-"));
  paths.home = join(paths.root, "home");
  mkdirSync(join(paths.home, ".modus", "agent"), { recursive: true });
  mkdirSync(join(paths.root, "pi-agent"));
  writeFileSync(
    join(paths.root, "pi-agent", "auth.json"),
    '{"synthetic":{"type":"api_key","key":"retained"}}',
  );
  writeFileSync(join(paths.home, ".modus", "mcp.json"), '{"mcpServers":{}}');
  database = new DatabaseSync(":memory:");
  database.exec(
    "create table model_configs (id text); insert into model_configs values ('historical'); create table model_provider_configs (id text); create table app_settings (key text); insert into app_settings values ('model.default'); create table agent_sessions (id text); insert into agent_sessions values ('retained-session');",
  );
});
afterEach(() => {
  database.close();
  rmSync(paths.root, { recursive: true, force: true });
});
it("backs up before schema cleanup, retains user files and never promotes credentials", () => {
  migrateAgentConfiguration(database);
  const report = JSON.parse(readFileSync(join(paths.root, "configuration-migration.json"), "utf8"));
  const backup = new DatabaseSync(join(report.backup, "modus.sqlite"), { readOnly: true });
  expect(backup.prepare("select id from model_configs").get()).toMatchObject({ id: "historical" });
  backup.close();
  expect(
    database.prepare("select name from sqlite_master where name = 'model_configs'").get(),
  ).toBeUndefined();
  expect(database.prepare("select id from agent_sessions").get()).toMatchObject({
    id: "retained-session",
  });
  expect(existsSync(join(paths.root, "pi-agent", "auth.json"))).toBe(true);
  expect(existsSync(join(paths.home, ".modus", "agent", "auth.json"))).toBe(false);
  expect(readFileSync(join(paths.home, ".modus", "agent", "mcp.json"), "utf8")).toBe(
    '{"mcpServers":{}}',
  );
  migrateAgentConfiguration(database);
  expect(
    JSON.parse(readFileSync(join(paths.root, "configuration-migration.json"), "utf8")).backup,
  ).toBe(report.backup);
});
it("records conflicting resource destinations without overwriting them", () => {
  const destination = join(paths.home, ".modus", "agent", "mcp.json");
  writeFileSync(destination, '{"mcpServers":{"fixture":{"command":"synthetic"}}}');
  const content = readFileSync(destination, "utf8");
  migrateAgentConfiguration(database);
  expect(readFileSync(destination, "utf8")).toBe(content);
  const report = JSON.parse(readFileSync(join(paths.root, "configuration-migration.json"), "utf8"));
  expect(report.changes[0].status).toBe("destination-preserved");
});
