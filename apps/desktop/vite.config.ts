import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { lockalDevDaemonPlugin } from "./vite-dev-daemon";

export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  plugins: [react(), lockalDevDaemonPlugin()],
  resolve: {
    alias: {
      // sql.js "browser" entry has no ESM default export; use wasm build + /public/sql-wasm.wasm
      "sql.js": path.resolve(__dirname, "../../node_modules/sql.js/dist/sql-wasm.js"),
      "node:fs": path.resolve(__dirname, "src/vite-empty-module.js"),
      "node:crypto": path.resolve(__dirname, "src/vite-empty-module.js"),
      "@lockal/application": path.resolve(__dirname, "../../packages/application/src"),
      "@lockal/database": path.resolve(__dirname, "../../packages/database/src"),
      "@lockal/crypto": path.resolve(__dirname, "../../packages/crypto/src"),
      "@lockal/domain": path.resolve(__dirname, "../../packages/domain/src"),
      "@lockal/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@lockal/permissions": path.resolve(__dirname, "../../packages/permissions/src"),
      "@lockal/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@lockal/messaging": path.resolve(__dirname, "../../packages/messaging/src"),
      "@lockal/sync": path.resolve(__dirname, "../../packages/sync/src"),
      "@lockal/networking": path.resolve(__dirname, "../../packages/networking/src"),
      "@lockal/file-transfer": path.resolve(__dirname, "../../packages/file-transfer/src"),
    },
  },
  optimizeDeps: {
    include: ["sql.js"],
  },
  assetsInclude: ["**/*.wasm"],
});
