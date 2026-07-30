const PROVIDER_LOGO_ALIASES: Record<string, string> = {
  "amazon-bedrock": "amazon-bedrock",
  "aws-bedrock": "amazon-bedrock",
  "azure-openai-responses": "azure",
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
  "kimi-coding": "kimi-for-coding",
  llmstudio: "lmstudio",
  "lm-studio": "lmstudio",
  moonshot: "moonshotai",
  "open-code": "opencode",
  "open-code-go": "opencode-go",
  "openai-codex": "openai",
  together: "togetherai",
  "together-ai": "togetherai",
  "vercel-ai-gateway": "vercel",
  "xiaomi-token-plan-ams": "xiaomi",
  "xiaomi-token-plan-cn": "xiaomi",
  "xiaomi-token-plan-sgp": "xiaomi",
  "zai-coding-cn": "zai-coding-plan",
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
  "openai-codex": "var(--color-fg)",
  openrouter: "#8b8cff",
  perplexity: "#20b8cd",
  // Monochrome ink marks — follow theme fg (same class as openai-codex).
  vercel: "var(--color-fg)",
  xai: "var(--color-fg)",
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

/** Theme foreground for mask fills that would vanish on one of the surfaces. */
const THEME_INK = "var(--color-fg)";

/**
 * Relative luminance of a #rgb / #rrggbb fill (sRGB). Non-hex / CSS vars pass
 * through unchanged — callers already chose an adaptive token.
 */
export function hexLuminance(color: string): number | undefined {
  const raw = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(raw);
  const long = /^#([0-9a-f]{6})$/i.exec(raw);
  let hex = long?.[1];
  if (!hex && short?.[1]) {
    hex = [...short[1]].map((c) => `${c}${c}`).join("");
  }
  if (!hex || hex.length !== 6) {
    return undefined;
  }
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Near-white / near-black brand fills fail on one theme when used as a mask tint.
 * Remap those to theme foreground; keep mid-tone brand colors as-is.
 */
export function resolveProviderLogoFill(color: string): string {
  if (color.startsWith("var(") || color === "currentColor") {
    return color;
  }
  const luminance = hexLuminance(color);
  if (luminance !== undefined && (luminance > 0.85 || luminance < 0.08)) {
    return THEME_INK;
  }
  return color;
}

export function providerLogoColor(provider: string, logoKey: string): string {
  const raw =
    PROVIDER_LOGO_COLORS[normalizeProviderLogoKey(provider)] ??
    PROVIDER_LOGO_COLORS[logoKey] ??
    "currentColor";
  return resolveProviderLogoFill(raw);
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
