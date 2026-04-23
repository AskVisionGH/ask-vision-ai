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
