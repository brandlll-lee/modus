import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const shim = require.resolve("codebase-memory-mcp/bin.js");
const binName = process.platform === "win32" ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
const source = join(dirname(shim), "bin", binName);

if (!existsSync(source)) {
  const result = spawnSync(process.execPath, [shim, "--version"], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0 || !existsSync(source)) {
    process.exit(result.status ?? 1);
  }
}

const destDir = join(dirname(fileURLToPath(import.meta.url)), "..", "resources", "bin");
const dest = join(destDir, binName);
mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
if (process.platform !== "win32") {
  chmodSync(dest, 0o755);
}
console.log(`Fast Codebase sidecar ready: ${dest}`);
