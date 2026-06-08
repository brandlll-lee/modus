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
      from: "resources/icon.png",
      to: "icon.png",
    },
    {
      from: "../../target/release/modus-pty-host.exe",
      to: "bin/modus-pty-host.exe",
    },
  ],
  asar: true,
  icon: "resources/icon.png",
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icon.icns",
    target: ["dmg", "zip"],
  },
  win: {
    icon: "resources/icon.ico",
    target: ["nsis"],
    signAndEditExecutable: false,
  },
  linux: {
    category: "Development",
    icon: "resources/icon.png",
    target: ["AppImage", "deb"],
  },
};

export default config;
