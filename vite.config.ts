import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  // Vite's default build.target is `es2020`. Several iOS in-app browsers
  // (Instagram/X/Discord WebViews on older iPhones) and any iOS Safari < 14
  // silently fail to parse es2020 syntax → permanent white screen with no
  // visible error. Lowering to es2019 keeps modern syntax for everyone on
  // iOS 14+ while widening compatibility with embedded WebKit.
  // (We don't ship a legacy fallback bundle: @solana/web3.js & bs58 use
  // BigInt literals, which iOS < 14 can't parse at all — those devices
  // can't run the wallet stack regardless of transpilation.)
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
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
