import { describe, expect, it } from "vitest";
import { createProviderLogoResolver, providerLogoFallbackLabel } from "./providerLogoRegistry";

const resolveProviderLogoKey = createProviderLogoResolver(
  new Set([
    "amazon-bedrock",
    "anthropic",
    "github-copilot",
    "google",
    "groq",
    "mistral",
    "openai",
    "synthetic",
    "togetherai",
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

  it("falls back to the synthetic logo and stable initials", () => {
    expect(resolveProviderLogoKey("private-relay")).toBe("synthetic");
    expect(providerLogoFallbackLabel("private-relay", "My Relay")).toBe("M");
    expect(providerLogoFallbackLabel("private-relay")).toBe("P");
  });
});
