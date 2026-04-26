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
  // iOS Safari < 14 silently fails to parse modern syntax → permanent white
  // screen with no visible error in in-app browsers (Instagram/X/Discord).
  // We can't go below es2020 because @solana/web3.js & bs58 use BigInt
  // literals (`0n`) which require native iOS 14+ support anyway. Targeting
  // Safari 14 explicitly tells esbuild what's safe to keep vs. transpile,
  // which fixes the white screen on any iOS device that can run BigInt.
  build: {
    target: ["es2020", "safari14", "ios14", "chrome87", "firefox78", "edge88"],
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
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core", "wagmi", "viem"],
  },
  // Force Vite to pre-bundle wagmi + rainbowkit alongside @tanstack/react-query
  // so they share the *same* react-query module instance as the app, otherwise
  // RainbowKitProvider's `useQueryClient` reads from a different React context
  // than the one our top-level QueryClientProvider mounts → "No QueryClient set".
  optimizeDeps: {
    include: [
      "@tanstack/react-query",
      "wagmi",
      "@rainbow-me/rainbowkit",
      "viem",
    ],
  },
}));
