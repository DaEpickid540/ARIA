// desktop/build.js — build the Windows installer: `npm run dist`
//
// The version comes from public/js/version.js (the single source of truth,
// see README): Mark 2.5 → app version 2.5.0, ARIA-Setup-Mark-2.5.exe.
// Output lands in dist/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build, Platform, Arch } from "electron-builder";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const versionSrc = fs.readFileSync(path.join(ROOT, "public", "js", "version.js"), "utf8");
const mark = versionSrc.match(/mark:\s*(\d+)/)?.[1];
const point = versionSrc.match(/point:\s*(\d+)/)?.[1];
if (!mark || !point) throw new Error("Couldn't read mark/point from public/js/version.js");
const markName = `${mark}.${point}`;

console.log(`Building ARIA Mark ${markName} for Windows…`);

await build({
  targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
  config: {
    appId: "com.daepickid540.aria",
    productName: "ARIA",
    copyright: "ARIA",
    // The packaged package.json gets the Mark version, so Windows' Apps list
    // shows 2.5.0 rather than the server's own 3.x.
    extraMetadata: { version: `${markName}.0` },
    directories: { output: "dist", buildResources: "desktop" },
    files: [
      "package.json",
      "server.js",
      "claw-relay.js",
      ".env.example",
      "desktop/main.js",
      "desktop/preload.cjs",
      "lib/**",
      "tools/**",
      "skills/**",
      "public/**",
      "!public/uploads/**",
      "!**/*.map",
    ],
    // Native binaries can't be loaded from inside app.asar.
    asarUnpack: ["node_modules/sharp/**", "node_modules/@img/**"],
    win: {
      icon: "public/icons/icon-512.png",
      artifactName: `ARIA-Setup-Mark-${markName}.\${ext}`,
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "ARIA",
      uninstallDisplayName: `ARIA (Mark ${markName})`,
      // Chats, memory and keys live in %APPDATA%\ARIA — keep them on uninstall.
      deleteAppDataOnUninstall: false,
    },
  },
});

console.log(`\nDone: dist/ARIA-Setup-Mark-${markName}.exe`);
