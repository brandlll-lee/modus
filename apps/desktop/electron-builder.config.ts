import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "dev.modus.desktop",
  productName: "Modus",
  electronVersion: "42.3.0",
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  compression: "store",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "package.json"],
  extraResources: [
    {
      from: "../../target/release/modus-pty-host.exe",
      to: "bin/modus-pty-host.exe",
    },
  ],
  asar: true,
  mac: {
    category: "public.app-category.developer-tools",
    target: ["dmg", "zip"],
  },
  win: {
    target: ["nsis"],
    signAndEditExecutable: false,
  },
  linux: {
    category: "Development",
    target: ["AppImage", "deb"],
  },
};

export default config;
