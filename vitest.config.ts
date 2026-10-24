import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real-model tests run via `npm run test:slow` (downloads the NLI model once).
    exclude: ["tests/**/*.slow.test.ts", "node_modules/**"],
  },
});
