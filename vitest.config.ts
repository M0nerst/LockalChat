import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@lockal/shared": path.resolve(__dirname, "packages/shared/src"),
      "@lockal/domain": path.resolve(__dirname, "packages/domain/src"),
      "@lockal/crypto": path.resolve(__dirname, "packages/crypto/src"),
      "@lockal/permissions": path.resolve(__dirname, "packages/permissions/src"),
      "@lockal/database": path.resolve(__dirname, "packages/database/src"),
      "@lockal/application": path.resolve(__dirname, "packages/application/src"),
      "@lockal/messaging": path.resolve(__dirname, "packages/messaging/src"),
      "@lockal/networking": path.resolve(__dirname, "packages/networking/src"),
      "@lockal/sync": path.resolve(__dirname, "packages/sync/src"),
      "@lockal/file-transfer": path.resolve(__dirname, "packages/file-transfer/src"),
    },
  },
});
