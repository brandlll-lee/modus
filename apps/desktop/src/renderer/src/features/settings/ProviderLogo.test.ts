import { describe, expect, it } from "vitest";
import {
  createProviderLogoResolver,
  providerLogoColor,
  providerLogoFallbackLabel,
} from "./providerLogoRegistry";

const resolveProviderLogoKey = createProviderLogoResolver(
  new Set([
    "amazon-bedrock",
    "anthropic",
    "azure",
    "github-copilot",
    "google",
    "groq",
    "kimi-for-coding",
    "mistral",
    "openai",
    "synthetic",
    "togetherai",
    "vercel",
    "xiaomi",
    "zai-coding-plan",
  ]),
);

describe("ProviderLogo", () => {
  it("resolves canonical provider ids to bundled logos", () => {
    expect(resolveProviderLogoKey("anthropic")).toBe("anthropic");
    expect(resolveProviderLogoKey("openai")).toBe("openai");
    expect(resolveProviderLogoKey("google")).toBe("google");
    expect(resolveProviderLogoKey("groq")).toBe("groq");
    expect(resolveProviderLogoKey("mistral")).toBe("mistral");
  });

  it("resolves common provider aliases", () => {
    expect(resolveProviderLogoKey("google-gemini")).toBe("google");
    expect(resolveProviderLogoKey("aws-bedrock")).toBe("amazon-bedrock");
    expect(resolveProviderLogoKey("github-copilot")).toBe("github-copilot");
    expect(resolveProviderLogoKey("together-ai")).toBe("togetherai");
  });

  it("maps built-in provider variants to their canonical logos", () => {
    expect(resolveProviderLogoKey("azure-openai-responses")).toBe("azure");
    expect(resolveProviderLogoKey("kimi-coding")).toBe("kimi-for-coding");
    expect(resolveProviderLogoKey("openai-codex")).toBe("openai");
    expect(resolveProviderLogoKey("together")).toBe("togetherai");
    expect(resolveProviderLogoKey("vercel-ai-gateway")).toBe("vercel");
    expect(resolveProviderLogoKey("xiaomi-token-plan-ams")).toBe("xiaomi");
    expect(resolveProviderLogoKey("xiaomi-token-plan-cn")).toBe("xiaomi");
    expect(resolveProviderLogoKey("xiaomi-token-plan-sgp")).toBe("xiaomi");
    expect(resolveProviderLogoKey("zai-coding-cn")).toBe("zai-coding-plan");
  });

  it("keeps the OpenAI API brand color and renders Codex with the theme foreground", () => {
    expect(providerLogoColor("openai", "openai")).toBe("#10a37f");
    expect(providerLogoColor("openai-codex", "openai")).toBe("var(--color-fg)");
  });

  it("falls back to the synthetic logo and stable initials", () => {
    expect(resolveProviderLogoKey("private-relay")).toBe("synthetic");
    expect(resolveProviderLogoKey("custom")).toBe("synthetic");
    expect(providerLogoFallbackLabel("private-relay", "My Relay")).toBe("M");
    expect(providerLogoFallbackLabel("private-relay")).toBe("P");
  });
});
