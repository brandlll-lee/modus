import { describe, expect, it } from "vitest";
import { interpolateEnv, parseMcpConfig } from "./mcp-config";

/** Literal "${env:NAME}" built from parts so lint doesn't read it as a template placeholder. */
const envRef = (name: string): string => ["${", "env:", name, "}"].join("");

describe("interpolateEnv", () => {
  it("substitutes env placeholders", () => {
    expect(interpolateEnv(`Bearer ${envRef("TOKEN")}`, { TOKEN: "abc" } as NodeJS.ProcessEnv)).toBe(
      "Bearer abc",
    );
  });

  it("resolves unset variables to an empty string", () => {
    expect(interpolateEnv(`x${envRef("MISSING")}y`, {} as NodeJS.ProcessEnv)).toBe("xy");
  });

  it("leaves plain strings untouched", () => {
    expect(interpolateEnv("no placeholders", {} as NodeJS.ProcessEnv)).toBe("no placeholders");
  });
});

describe("parseMcpConfig", () => {
  const env = { API_KEY: "k-123" } as NodeJS.ProcessEnv;

  it("parses stdio servers with args and env interpolation", () => {
    const { servers, errors } = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          files: {
            command: "npx",
            args: ["-y", `server-${envRef("API_KEY")}`],
            env: { KEY: envRef("API_KEY") },
          },
        },
      }),
      "test.json",
      env,
    );
    expect(errors).toEqual([]);
    expect(servers).toHaveLength(1);
    const server = servers[0];
    expect(server).toMatchObject({
      name: "files",
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-k-123"],
      enabled: true,
      source: "test.json",
    });
    if (server?.transport === "stdio") {
      expect(server.env).toEqual({ KEY: "k-123" });
    }
  });

  it("parses http servers with headers", () => {
    const { servers } = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          remote: {
            url: "https://example.com/mcp",
            headers: { Authorization: envRef("API_KEY") },
          },
        },
      }),
      "test.json",
      env,
    );
    expect(servers[0]).toMatchObject({
      transport: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "k-123" },
    });
  });

  it("honors disabled/enabled flags", () => {
    const { servers } = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          off: { command: "x", disabled: true },
          alsoOff: { command: "y", enabled: false },
          on: { command: "z" },
        },
      }),
      "test.json",
      env,
    );
    expect(servers.map((server) => [server.name, server.enabled])).toEqual([
      ["off", false],
      ["alsoOff", false],
      ["on", true],
    ]);
  });

  it("collects errors for invalid entries without dropping valid ones", () => {
    const { servers, errors } = parseMcpConfig(
      JSON.stringify({ mcpServers: { broken: {}, ok: { command: "run" } } }),
      "test.json",
      env,
    );
    expect(servers.map((server) => server.name)).toEqual(["ok"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('"broken"');
  });

  it("reports invalid JSON as a single error", () => {
    const { servers, errors } = parseMcpConfig("{not json", "bad.json", env);
    expect(servers).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.source).toBe("bad.json");
  });

  it("reports a missing mcpServers object", () => {
    const { errors } = parseMcpConfig("{}", "empty.json", env);
    expect(errors[0]?.message).toContain("mcpServers");
  });
});
