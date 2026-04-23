import { Buffer } from "buffer";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// @solana/spl-token (loaded by TransferPreviewCard for client-side tx building)
// expects Node's Buffer global. Polyfill it before any wallet code runs.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

createRoot(document.getElementById("root")!).render(<App />);
