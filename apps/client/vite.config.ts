import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const clientRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: clientRoot,
  resolve: {
    alias: {
      "@disc-arena/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url)
      )
    }
  }
});
