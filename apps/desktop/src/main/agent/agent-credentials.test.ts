import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentCredentials } from "./agent-credentials";

let root: string;
let cli: string;
let own: string;
let store: AgentCredentials;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-credentials-"));
  cli = join(root, "cli");
  own = join(root, "own");
  mkdirSync(cli);
  mkdirSync(own);
  store = new AgentCredentials(cli, own, () => new Set(["isolated"]));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("selects complete provider credentials without merging fields", async () => {
  writeFileSync(
    join(cli, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "lower", env: { LOWER: "value" } },
      isolated: { type: "api_key", key: "private" },
    }),
  );
  writeFileSync(
    join(own, "auth.json"),
    JSON.stringify({ fixture: { type: "api_key", key: "higher" } }),
  );
  expect(await store.read("fixture")).toEqual({ type: "api_key", key: "higher" });
  expect(await store.read("isolated")).toBeUndefined();
  expect(await store.list()).toEqual([{ providerId: "fixture", type: "api_key" }]);
});
it("refuses inherited mutations before invoking an OAuth refresh callback", async () => {
  const path = join(cli, "auth.json");
  const document = JSON.stringify({
    fixture: { type: "oauth", access: "synthetic", refresh: "synthetic", expires: 1 },
  });
  writeFileSync(path, document);
  const refresh = vi.fn();
  await expect(store.modify("fixture", refresh)).rejects.toThrow("read-only");
  expect(refresh).not.toHaveBeenCalled();
  expect(readFileSync(path, "utf8")).toBe(document);
  writeFileSync(path, JSON.stringify({ fixture: { type: "api_key", key: "external-change" } }));
  expect(await store.read("fixture")).toEqual({ type: "api_key", key: "external-change" });
});
it("serializes native read-modify-write callbacks between store instances", async () => {
  const other = new AgentCredentials(cli, own, () => new Set());
  await Promise.all(
    [store, other, store].map((instance) =>
      instance.modify("fixture", async (current) => ({
        type: "oauth",
        access: "synthetic",
        refresh: "synthetic",
        expires: (current?.type === "oauth" ? current.expires : 0) + 1,
      })),
    ),
  );
  expect((await store.read("fixture"))?.type).toBe("oauth");
  expect(JSON.parse(readFileSync(join(own, "auth.json"), "utf8")).fixture.expires).toBe(3);
});
it("lists command credentials without executing them and resolves scoped environment references on read", async () => {
  writeFileSync(
    join(own, "auth.json"),
    JSON.stringify({
      command: { type: "api_key", key: "!this-command-must-not-execute" },
      fixture: { type: "api_key", key: `\${SYNTHETIC_KEY}$$$!`, env: { SYNTHETIC_KEY: "value" } },
    }),
  );
  expect((await store.list()).map((entry) => entry.providerId)).toEqual(["command", "fixture"]);
  expect(await store.read("fixture")).toMatchObject({ key: "value$!" });
});
