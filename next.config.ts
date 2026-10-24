import type { NextConfig } from "next";

// cacheComponents is deliberately off: this app is request-time dynamic (SSE runs, per-run
// results) and Cache Components rejects the `runtime`/`dynamic` route exports and sync IO
// during prerender. See STAGE.md decisions (2026-10-24).
const nextConfig: NextConfig = {
  // NLI/embedding models run in Node via onnxruntime; keep these out of the server bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pino"],
  turbopack: {
    // Pin the workspace root: a stray lockfile in a parent directory otherwise confuses root detection.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
