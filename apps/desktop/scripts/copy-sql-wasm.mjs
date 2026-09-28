import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const src = path.join(repoRoot, "node_modules/sql.js/dist/sql-wasm.wasm");
const destDir = path.join(here, "../public");
const dest = path.join(destDir, "sql-wasm.wasm");

if (!fs.existsSync(src)) {
  console.error("sql-wasm.wasm not found. Run npm install at repo root.");
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("Copied sql-wasm.wasm → apps/desktop/public/");
