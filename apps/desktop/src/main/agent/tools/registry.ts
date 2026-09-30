import type { ToolCallEvent, ToolDefinition, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { PermissionAction } from "../../../shared/contracts";
import {
  BUILTIN_TOOL_CATALOG,
  type ToolCapability,
  type ToolCatalogEntry,
  type ToolProfileName,
} from "../../../shared/tools";
import { isRuntimeTool } from "../runtime-tools";

/**
 * Runtime tool registry. Wraps the shared catalog with PI-SDK-dependent behavior:
 * dynamic permission classification and custom-tool registration. Built-in tools
 * come from the shared catalog; custom tools are registered at runtime and flow
 * through the same activation/permission/UI pipeline.
 */

export type ToolClassification = {
  action: PermissionAction;
  dangerous: boolean;
};

export type ToolClassifier = (event: ToolCallEvent) => ToolClassification;

/** Per-session adjustments layered on top of a profile's default active set. */
export type ToolOverrides = {
  enable?: string[];
  disable?: string[];
};

const WRITE_CAPABILITIES = new Set<ToolCapability>(["write", "shell", "process"]);

export type RegisterToolInput = {
  /** Catalog metadata; `kind` is forced to "custom". */
  entry: Omit<ToolCatalogEntry, "kind">;
  /** The PI tool definition handed to `createAgentSession({ customTools })`. */
  definition: ToolDefinition;
  /** Optional dynamic permission classifier (for tools whose risk depends on args). */
  classify?: ToolClassifier;
};

const DEFAULT_ACTION: PermissionAction = "tool.execute";

/** Primary target string for a tool call (command, path, else the raw input). */
export function getToolTarget(event: ToolCallEvent): string {
  if ("command" in event.input && typeof event.input.command === "string") {
    return event.input.command;
  }
  if ("path" in event.input && typeof event.input.path === "string") {
    return event.input.path;
  }
  return JSON.stringify(event.input);
}

export class ToolRegistry {
  private readonly entries = new Map<string, ToolCatalogEntry>();
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly classifiers = new Map<string, ToolClassifier>();

  constructor(builtins: ToolCatalogEntry[] = BUILTIN_TOOL_CATALOG) {
    for (const entry of builtins) {
      this.entries.set(entry.name, entry);
    }
  }

  /** Register a custom LLM-callable tool. It joins the activation/permission/UI pipeline. */
  registerTool(input: RegisterToolInput): void {
    const entry: ToolCatalogEntry = { ...input.entry, kind: "custom" };
    this.entries.set(entry.name, entry);
    this.definitions.set(entry.name, input.definition);
    if (input.classify) {
      this.classifiers.set(entry.name, input.classify);
    }
  }

  /** Remove a previously registered custom tool (no-op for builtins/unknown). */
  unregisterTool(name: string): void {
    if (this.entries.get(name)?.kind !== "custom") {
      return;
    }
    this.entries.delete(name);
    this.definitions.delete(name);
    this.classifiers.delete(name);
  }

  /** Active tool names for a profile → `createAgentSession({ tools })`. */
  resolveActiveTools(profile: ToolProfileName, overrides?: ToolOverrides): string[] {
    const active = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.profiles.includes(profile)) {
        active.add(entry.name);
      }
    }
    for (const name of overrides?.enable ?? []) {
      active.add(name);
    }
    for (const name of overrides?.disable ?? []) {
      active.delete(name);
    }
    return [...active];
  }

  /** Custom tool definitions active for a profile → `createAgentSession({ customTools })`. */
  getCustomToolDefinitions(profile: ToolProfileName, overrides?: ToolOverrides): ToolDefinition[] {
    const active = new Set(this.resolveActiveTools(profile, overrides));
    const definitions: ToolDefinition[] = [];
    for (const [name, definition] of this.definitions) {
      if (active.has(name)) {
        definitions.push(definition);
      }
    }
    return definitions;
  }

  /** Decide whether a tool call needs approval and under which permission action. */
  private entryFor(
    name: string,
    definition?: ToolDefinition,
    source?: ToolInfo["sourceInfo"],
  ): ToolCatalogEntry | undefined {
    const entry = this.entries.get(name);
    if (!definition && !source) return entry;
    if (entry?.kind === "builtin")
      return source?.source === "builtin" && source.path === `builtin:${name}` ? entry : undefined;
    return definition && this.definitions.get(name) === definition ? entry : undefined;
  }

  classify(
    event: ToolCallEvent,
    definition?: ToolDefinition,
    source?: ToolInfo["sourceInfo"],
  ): ToolClassification {
    if (isRuntimeTool(definition)) return { action: DEFAULT_ACTION, dangerous: false };
    const entry = this.entryFor(event.toolName, definition, source);
    const classifier = entry && this.classifiers.get(event.toolName);
    if (classifier) {
      return classifier(event);
    }
    if (entry) {
      return {
        action: entry.permission.action ?? DEFAULT_ACTION,
        dangerous: entry.permission.danger !== "safe",
      };
    }
    return { action: DEFAULT_ACTION, dangerous: true };
  }

  getEntry(name: string): ToolCatalogEntry | undefined {
    return this.entries.get(name);
  }

  allowsProfile(
    name: string,
    profile: ToolProfileName,
    definition?: ToolDefinition,
    source?: ToolInfo["sourceInfo"],
  ): boolean {
    if (isRuntimeTool(definition)) return true;
    return (
      this.entryFor(name, definition, source)?.profiles.includes(profile) ?? profile === "chat"
    );
  }

  capabilitiesFor(
    name: string,
    definition?: ToolDefinition,
    source?: ToolInfo["sourceInfo"],
  ): ToolCapability[] {
    if (isRuntimeTool(definition)) return ["read"];
    const entry = this.entryFor(name, definition, source);
    if (!entry) {
      return ["write"];
    }
    if (entry.capabilities) {
      return entry.capabilities;
    }
    if (entry.readOnly === false || entry.permission.danger !== "safe") {
      return ["write"];
    }
    return ["read"];
  }

  isReadOnlySafe(
    name: string,
    definition?: ToolDefinition,
    source?: ToolInfo["sourceInfo"],
  ): boolean {
    return !this.capabilitiesFor(name, definition, source).some((capability) =>
      WRITE_CAPABILITIES.has(capability),
    );
  }

  matchesSelector(
    name: string,
    selector: string,
    definition?: ToolDefinition,
    source?: ToolInfo["sourceInfo"],
  ): boolean {
    const normalized = selector.trim();
    if (!normalized) {
      return false;
    }
    if (this.entries.has(normalized)) return name === normalized;
    return (
      name === normalized ||
      this.capabilitiesFor(name, definition, source).includes(normalized as ToolCapability)
    );
  }
}

/** Process-wide registry seeded with the built-in tools. */
export const toolRegistry = new ToolRegistry();
