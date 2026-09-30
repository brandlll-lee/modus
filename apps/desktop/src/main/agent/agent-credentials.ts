import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { readConfigObject } from "./agent-config-files";

const commandValues = new Map<string, string | undefined>();

function resolveKey(value: string, env?: Record<string, string>): string | undefined {
  if (value.startsWith("!")) {
    if (commandValues.has(value)) return commandValues.get(value);
    const { shell, args, commandTransport } = getShellConfig();
    const stdin = commandTransport === "stdin";
    const result = spawnSync(shell, stdin ? args : [...args, value.slice(1)], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      ...(stdin ? { input: value.slice(1) } : {}),
    });
    const resolved = result.status === 0 ? result.stdout.trim() || undefined : undefined;
    commandValues.set(value, resolved);
    return resolved;
  }
  let missing = false;
  const resolved = value.replace(
    /\$(\$|!|\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/g,
    (token: string, reference: string) => {
      if (reference === "$" || reference === "!") return reference;
      const name = reference.startsWith("{") ? reference.slice(1, -1) : reference;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return token;
      const entry = env?.[name] || process.env[name];
      if (!entry) missing = true;
      return entry ?? "";
    },
  );
  return missing ? undefined : resolved;
}

function readCredentials(path: string): Record<string, Credential> {
  const entries = readConfigObject(path);
  for (const value of Object.values(entries)) {
    if (
      !value ||
      typeof value !== "object" ||
      !("type" in value) ||
      (value.type !== "api_key" && value.type !== "oauth")
    )
      throw new Error(`${path}: invalid credential.`);
  }
  return entries as Record<string, Credential>;
}

export class AgentCredentials implements CredentialStore {
  constructor(
    private readonly inheritedDir: string,
    private readonly agentDir: string,
    private readonly isolatedProviders: () => ReadonlySet<string>,
  ) {}

  private selected(provider: string): { path: string; credential: Credential | undefined } {
    const path = join(this.agentDir, "auth.json");
    const own = readCredentials(path)[provider];
    if (own || this.isolatedProviders().has(provider)) return { path, credential: own };
    const inherited = join(this.inheritedDir, "auth.json");
    return { path: inherited, credential: readCredentials(inherited)[provider] };
  }

  source(provider: string): string | undefined {
    const selected = this.selected(provider);
    return selected.credential ? selected.path : undefined;
  }

  async read(provider: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    const { credential } = this.selected(provider);
    if (credential?.type !== "api_key" || credential.key === undefined) return credential;
    const { key, ...rest } = credential;
    const resolved = resolveKey(key, credential.env);
    return { ...rest, ...(resolved === undefined ? {} : { key: resolved }) };
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const inherited = readCredentials(join(this.inheritedDir, "auth.json"));
    for (const id of this.isolatedProviders()) delete inherited[id];
    return Object.entries({
      ...inherited,
      ...readCredentials(join(this.agentDir, "auth.json")),
    }).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  async modify(
    provider: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.update(
      provider,
      async (data) => {
        const next = await fn(data[provider]);
        if (next !== undefined) data[provider] = next;
        return data[provider];
      },
      options,
    );
  }

  async delete(provider: string, options?: AuthOperationOptions): Promise<void> {
    if (
      !this.isolatedProviders().has(provider) &&
      readCredentials(join(this.inheritedDir, "auth.json"))[provider]
    )
      throw new Error(`Inherited credentials are read-only. Manage ${provider} with PI CLI.`);
    await this.update(
      provider,
      async (data) => {
        delete data[provider];
      },
      options,
    );
  }

  private async update<T>(
    provider: string,
    fn: (data: Record<string, Credential>) => Promise<T>,
    options?: AuthOperationOptions,
  ): Promise<T> {
    options?.signal?.throwIfAborted();
    const selected = this.selected(provider);
    const path = join(this.agentDir, "auth.json");
    if (selected.credential && selected.path !== path)
      throw new Error(
        `Inherited credentials are read-only. Refresh ${provider} with PI CLI, then reload Modus.`,
      );
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, "{}\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const release = await lockfile.lock(path, {
      realpath: false,
      stale: 30_000,
      retries: { retries: 10, minTimeout: 50, maxTimeout: 1_000 },
    });
    try {
      options?.signal?.throwIfAborted();
      const data = readCredentials(path);
      const before = JSON.stringify(data);
      const result = await fn(data);
      if (JSON.stringify(data) !== before)
        writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      return result;
    } finally {
      await release();
    }
  }
}
