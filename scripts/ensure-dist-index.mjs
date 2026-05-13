import { copyFile } from "node:fs/promises";

await copyFile("dist/src-index.html", "dist/index.html");

await Promise.all(
  [
    "manifest.json",
    "OneSignalSDKWorker.js",
    "favicon-32.png",
    "apple-touch-icon.png",
    "icon-180.png",
    "icon-192.png",
    "icon-512.png",
    "icon-1024.png"
  ].map((file) => copyFile(file, `dist/${file}`))
);
