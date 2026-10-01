import { IconCube, IconSparkles } from "@tabler/icons-react";
import { cn } from "../../lib/cn";
import {
  createProviderLogoResolver,
  providerLogoColor,
  providerLogoFallbackLabel,
} from "./providerLogoRegistry";

type ProviderLogoProps = {
  provider: string;
  name?: string;
  size?: "sm" | "md" | "lg";
  framed?: boolean;
};

const assets = import.meta.glob<string>("../../assets/provider-logos/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});
const resolveLogo = createProviderLogoResolver(
  new Set(
    Object.keys(assets).map(
      (path) =>
        path
          .split("/")
          .pop()
          ?.replace(/\.svg$/, "") ?? "",
    ),
  ),
);

export function ProviderLogo({ provider, name, size = "md", framed = true }: ProviderLogoProps) {
  const key = resolveLogo(provider, name);
  const url = key ? assets[`../../assets/provider-logos/${key}.svg`] : undefined;
  const label = providerLogoFallbackLabel(provider, name);
  const iconSize = size === "lg" ? 17 : size === "sm" ? 12 : 15;
  return (
    <span
      aria-label={`${name ?? provider} provider logo`}
      role="img"
      data-logo-state={url ? "ready" : "fallback"}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden text-fg-muted",
        size === "lg" ? "size-10" : size === "sm" ? "size-5" : "size-8",
        framed && "rounded-md border border-hairline bg-chip",
      )}
    >
      {url && key ? (
        <span
          className={cn(
            "size-full",
            framed && (size === "sm" ? "border-[3px]" : "border-[7px]"),
            "border-transparent",
          )}
          style={{
            backgroundColor: providerLogoColor(provider, key),
            maskImage: `url("${url}")`,
            maskPosition: "center",
            maskRepeat: "no-repeat",
            maskSize: "contain",
            maskOrigin: "content-box",
            maskClip: "content-box",
          }}
        />
      ) : provider === "synthetic" || provider === "custom" ? (
        <IconSparkles size={iconSize} stroke={1.7} />
      ) : label ? (
        <span className={size === "sm" ? "text-[9px]" : "text-xs"}>{label}</span>
      ) : (
        <IconCube size={iconSize} stroke={1.7} />
      )}
    </span>
  );
}
