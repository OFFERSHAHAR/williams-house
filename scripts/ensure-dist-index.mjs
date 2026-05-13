import { copyFile } from "node:fs/promises";

await copyFile("dist/src-index.html", "dist/index.html");
