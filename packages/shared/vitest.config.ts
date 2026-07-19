import { defineConfig } from "vitest/config";

// The shared package is pure logic — schemas, catalog, status rules — so it
// needs no DOM and runs far faster in the default node environment.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
