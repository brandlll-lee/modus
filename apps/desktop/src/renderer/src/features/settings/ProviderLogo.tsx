import { IconCube, IconSparkles } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import {
  createProviderLogoResolver,
  PROVIDER_LOGO_COLORS,
  providerLogoFallbackLabel,
} from "./providerLogoRegistry";

type ProviderLogoSize = "sm" | "md" | "lg";
type ProviderLogoState = "loading" | "ready" | "fallback";

type ProviderLogoProps = {
  provider: string;
  name?: string;
  size?: ProviderLogoSize;
  /** false → no chip frame: just the transparent masked glyph (composer inline use). */
  framed?: boolean;
};

type ProviderLogoAsset = {
  key: string;
  url: string;
};

const providerLogoModules = import.meta.glob<string>("../../assets/provider-logos/*.svg", {
  query: "?url",
  import: "default",
});

const availableProviderLogos = new Set(
  Object.keys(providerLogoModules).map(
    (path) =>
      path
        .split("/")
        .pop()
        ?.replace(/\.svg$/, "") ?? "",
  ),
);
const resolveProviderLogoKey = createProviderLogoResolver(availableProviderLogos);

const providerLogoCache = new Map<string, Promise<ProviderLogoAsset | undefined>>();

export function ProviderLogo({ provider, name, size = "md", framed = true }: ProviderLogoProps) {
  const [asset, setAsset] = useState<ProviderLogoAsset | undefined>();
  const [state, setState] = useState<ProviderLogoState>("loading");
  const logoKey = useMemo(() => resolveProviderLogoKey(provider, name), [provider, name]);
  const label = providerLogoFallbackLabel(provider, name);
  const boxClass = size === "lg" ? "size-10" : size === "sm" ? "size-5" : "size-8";
  const readyPad = framed
    ? size === "lg"
      ? "p-[8px]"
      : size === "sm"
        ? "p-[3px]"
        : "p-[7px]"
    : "p-0";
  const fallbackIconSize = size === "lg" ? 17 : size === "sm" ? 12 : 15;

  useEffect(() => {
    let alive = true;
    setAsset(undefined);

    if (!logoKey) {
      setState("fallback");
      return () => {
        alive = false;
      };
    }

    setState("loading");
    void loadProviderLogo(logoKey)
      .then((nextAsset) => {
        if (!alive) {
          return;
        }
        setAsset(nextAsset);
        setState(nextAsset ? "ready" : "fallback");
      })
      .catch(() => {
        if (alive) {
          setState("fallback");
        }
      });

    return () => {
      alive = false;
    };
  }, [logoKey]);

  return (
    <span
      aria-label={`${name ?? provider} provider logo`}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden text-fg-muted",
        framed &&
          "rounded-md border border-hairline bg-chip shadow-composer transition-colors group-hover:border-hairline-strong",
        boxClass,
      )}
      data-logo-state={state}
      role="img"
    >
      <AnimatePresence initial={false} mode="wait">
        {state === "ready" && asset ? (
          <m.span
            animate={{ opacity: 1, scale: 1 }}
            className={cn("flex size-full items-center justify-center text-fg-muted", readyPad)}
            exit={{ opacity: 0, scale: 0.94 }}
            initial={{ opacity: 0, scale: 0.94 }}
            key={asset.key}
            style={{
              WebkitMaskImage: `url("${asset.url}")`,
              WebkitMaskPosition: "center",
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskSize: "contain",
              backgroundColor: providerLogoColor(asset.key),
              maskImage: `url("${asset.url}")`,
              maskPosition: "center",
              maskRepeat: "no-repeat",
              maskSize: "contain",
            }}
            transition={{ duration: 0.14, ease: "easeOut" }}
          />
        ) : state === "loading" ? (
          <m.span
            animate={{ opacity: 0.7 }}
            className={cn("rounded bg-chip-strong", size === "sm" ? "size-2.5" : "size-4")}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="loading"
            transition={{ duration: 0.14, ease: "easeOut" }}
          />
        ) : (
          <m.span
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              "flex items-center justify-center",
              size === "sm" ? "text-[9px]" : "text-xs",
            )}
            exit={{ opacity: 0, scale: 0.94 }}
            initial={{ opacity: 0, scale: 0.94 }}
            key="fallback"
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {provider === "synthetic" || provider === "custom" ? (
              <IconSparkles size={fallbackIconSize} stroke={1.7} />
            ) : label ? (
              label
            ) : (
              <IconCube size={fallbackIconSize} stroke={1.7} />
            )}
          </m.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function loadProviderLogo(key: string): Promise<ProviderLogoAsset | undefined> {
  const cached = providerLogoCache.get(key);
  if (cached) {
    return cached;
  }

  const path = `../../assets/provider-logos/${key}.svg`;
  const loader = providerLogoModules[path];
  const promise = loader ? loader().then((url) => ({ key, url })) : Promise.resolve(undefined);
  providerLogoCache.set(key, promise);
  return promise;
}

function providerLogoColor(key: string): string {
  return PROVIDER_LOGO_COLORS[key] ?? "currentColor";
}
