import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@sidestage/config": new URL("./packages/config/src/index.ts", import.meta.url).pathname,
      "@sidestage/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      sidestage: new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
    },
  },
});
