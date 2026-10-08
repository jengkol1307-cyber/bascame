import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const maplibrePackagePath = require.resolve("maplibre-gl/package.json");
const workerPath = join(dirname(maplibrePackagePath), "dist", "maplibre-gl-worker.mjs");
const destinationPath = join(process.cwd(), "public", "maplibre-gl-worker.mjs");

copyFileSync(workerPath, destinationPath);
