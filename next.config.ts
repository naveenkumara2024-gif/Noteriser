import type { NextConfig } from "next";

// cacheComponents is deliberately off: this app is request-time dynamic (SSE runs, per-run
// results) and Cache Components rejects the `runtime`/`dynamic` route exports and sync IO
// during prerender. See STAGE.md decisions (2026-10-24).
const dev = process.env.NODE_ENV !== "production";

// Everything the app loads comes from its own origin: no third-party scripts, fonts, analytics or
// frames. The inline allowance is needed for Next's own bootstrap data and for the small script that
// applies display settings before first paint; a nonce-based policy would need per-request rendering
// of every page and is listed as a residual risk. Dev mode also needs eval and a websocket for HMR.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
