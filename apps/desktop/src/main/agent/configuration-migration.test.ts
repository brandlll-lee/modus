import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => paths.root } }));

import { migrateAgentConfiguration } from "./configuration-migration";

let database: DatabaseSync;
beforeEach(() => {
  paths.root = mkdtempSync(join(tmpdir(), "modus-migration-"));
  mkdirSync(join(paths.root, "pi-agent"));
  writeFileSync(
    join(paths.root, "pi-agent", "auth.json"),
    '{"synthetic":{"type":"api_key","key":"retained"}}',
  );
  database = new DatabaseSync(":memory:");
  database.exec(
    "create table model_configs (id text); insert into model_configs values ('historical'); create table model_provider_configs (id text); create table app_settings (key text); insert into app_settings values ('model.default'); create table agent_sessions (id text); insert into agent_sessions values ('retained-session');",
  );
});
afterEach(() => {
  database.close();
  rmSync(paths.root, { recursive: true, force: true });
});
it("backs up configuration and session data before schema cleanup", () => {
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
  expect(readFileSync(join(report.backup, "pi-agent", "auth.json"), "utf8")).toBe(
    readFileSync(join(paths.root, "pi-agent", "auth.json"), "utf8"),
  );
  migrateAgentConfiguration(database);
  expect(
    JSON.parse(readFileSync(join(paths.root, "configuration-migration.json"), "utf8")).backup,
  ).toBe(report.backup);
});
