import { copyFile } from "node:fs/promises";

await copyFile("dist/source-index.html", "dist/index.html");
await copyFile("dist/source-index.html", "dist/src-index.html");

await Promise.all(
  [
    "manifest.json",
    "OneSignalSDKWorker.js",
    "home-logo-favicon-32.png",
    "home-logo-180.png",
    "home-logo-192.png",
    "home-logo-512.png",
    "home-logo-1024.png",
    "favicon-32.png",
    "apple-touch-icon.png",
    "icon-180.png",
    "icon-192.png",
    "icon-512.png",
    "icon-1024.png"
  ].map((file) => copyFile(file, `dist/${file}`))
);
