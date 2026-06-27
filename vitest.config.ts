import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        // Allow Vitest to use native CJS tree-sitter bindings without transform
        external: ["tree-sitter", /^tree-sitter-.*/],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server/index.ts"],
    },
    testTimeout: 30000,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
