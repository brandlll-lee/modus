const PROVIDER_LOGO_ALIASES: Record<string, string> = {
  "amazon-bedrock": "amazon-bedrock",
  "aws-bedrock": "amazon-bedrock",
  bedrock: "amazon-bedrock",
  cloudflare: "cloudflare-workers-ai",
  copilot: "github-copilot",
  fireworks: "fireworks-ai",
  gemini: "google",
  "github-copilot": "github-copilot",
  google: "google",
  "google-gemini": "google",
  "hugging-face": "huggingface",
  huggingface: "huggingface",
  llmstudio: "lmstudio",
  "lm-studio": "lmstudio",
  moonshot: "moonshotai",
  "open-code": "opencode",
  "open-code-go": "opencode-go",
  "together-ai": "togetherai",
  zhipu: "zhipuai",
};

export const PROVIDER_LOGO_COLORS: Record<string, string> = {
  "amazon-bedrock": "#ff9900",
  anthropic: "#d4a27f",
  cerebras: "#f05a28",
  cloudflare: "#f38020",
  "cloudflare-ai-gateway": "#f38020",
  "cloudflare-workers-ai": "#f38020",
  deepseek: "#4d8cff",
  "fireworks-ai": "#ffb020",
  google: "#8ab4f8",
  groq: "#ff5a1f",
  mistral: "#ff7000",
  openai: "#10a37f",
  openrouter: "#8b8cff",
  perplexity: "#20b8cd",
  vercel: "#f5f5f5",
  xai: "#e8e8e8",
  zai: "#7dd3fc",
};

export function createProviderLogoResolver(availableProviderLogos: ReadonlySet<string>) {
  return (provider: string, name?: string): string | undefined => {
    const candidates = [
      provider,
      PROVIDER_LOGO_ALIASES[normalizeProviderLogoKey(provider)] ?? "",
      name ?? "",
      PROVIDER_LOGO_ALIASES[normalizeProviderLogoKey(name ?? "")] ?? "",
    ]
      .map(normalizeProviderLogoKey)
      .filter(Boolean);

    for (const candidate of candidates) {
      if (availableProviderLogos.has(candidate)) {
        return candidate;
      }
    }

    return availableProviderLogos.has("synthetic") ? "synthetic" : undefined;
  };
}

export function providerLogoFallbackLabel(provider: string, name?: string): string {
  const source = name?.trim() || provider.trim();
  return source.slice(0, 1).toUpperCase();
}

export function normalizeProviderLogoKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("&", " and ")
    .replaceAll("+", " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
