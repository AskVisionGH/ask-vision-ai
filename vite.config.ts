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
    // Production-only: emit a second bundle that runs on iOS 12+, older Android
    // WebViews, and most in-app browsers. Modern browsers still get the fast
    // ES2019 bundle via <script type="module">.
    mode !== "development" &&
      legacy({
        targets: ["defaults", "not IE 11", "iOS >= 12", "Safari >= 12"],
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
