import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["tmp/**", "dist/**", "node_modules/**"],
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
      exclude: ["node_modules/", "dist/", "**/*.d.ts", "**/*.config.*", "**/__tests__/**"],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
})
