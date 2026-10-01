import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { app } from "electron";

export function migrateAgentConfiguration(database: DatabaseSync): void {
  const dataDir = app.getPath("userData");
  const marker = join(dataDir, "configuration-migration.json");
  const tables = database
    .prepare(
      "select name from sqlite_master where type = 'table' and name in ('model_configs', 'model_provider_configs')",
    )
    .all();
  if (existsSync(marker) && tables.length === 0) return;
  const oldAgent = join(dataDir, "pi-agent");
  const archived = ["auth.json", "models.json", "settings.json"]
    .map((name) => join(oldAgent, name))
    .filter(existsSync);
  if (!tables.length && !archived.length) return;
  mkdirSync(dataDir, { recursive: true });
  const backup = mkdtempSync(join(dataDir, "configuration-backup-"));
  database.prepare("VACUUM INTO ?").run(join(backup, "modus.sqlite"));
  for (const path of archived) {
    const destination = join(backup, "pi-agent", basename(path));
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    cpSync(path, destination, { errorOnExist: true, force: false });
  }
  database.exec("BEGIN");
  try {
    database.exec(
      "DROP TABLE IF EXISTS model_configs; DROP TABLE IF EXISTS model_provider_configs;",
    );
    database.prepare("delete from app_settings where key = ?").run("model.default");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const report = { backup, archived, completedAt: new Date().toISOString() };
  writeFileSync(marker, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
