import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import legacy from "@vitejs/plugin-legacy";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  // Vite's default build.target is `es2020`, which iOS Safari < 14 (and many
  // mobile in-app browsers like Instagram/X/Discord on older devices) cannot
  // parse — they silently fail with a permanent white screen. Lower the
  // baseline and use @vitejs/plugin-legacy to ship a transpiled fallback bundle
  // for those older WebKits.
  build: {
    target: "es2019",
  },
  plugins: [
    react(),
    // @solana/spl-token + bn.js + bs58 expect Node's `Buffer`, `process`, and
    // `global` to exist in the browser. This plugin shims them so the wallet
    // side of the app can build SPL transfer transactions client-side.
    nodePolyfills({
      include: ["buffer", "process", "util", "stream"],
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true,
    }),
    // Production-only: emit a second bundle that runs on older iOS WebKit and
    // older Android WebViews / in-app browsers. Modern browsers still get the
    // fast ES2019 bundle via <script type="module">.
    // NOTE: targets bottom out at iOS/Safari 14 because @solana/web3.js and
    // bs58 use BigInt literals (`0n`), which iOS < 14 cannot parse at all.
    // Targets are explicit (no "defaults") because that browserslist query
    // includes Safari 12 which would fail the build for the same reason.
    mode !== "development" &&
      legacy({
        targets: [
          "iOS >= 14",
          "Safari >= 14",
          "Chrome >= 64",
          "Firefox >= 67",
          "Edge >= 79",
        ],
        modernPolyfills: true,
        renderLegacyChunks: true,
      }),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
