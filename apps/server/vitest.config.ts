import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@disc-arena/core": new URL(
        "../../packages/core/src/index.ts",
        import.meta.url
      ).pathname
    }
  }
});
