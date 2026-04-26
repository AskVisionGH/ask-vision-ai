import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installConsoleFilter } from "./lib/console-filter";
import "./index.css";

// Hide noisy errors from wallet extensions (Phantom's eth.merkle.io CORS
// failures, etc.) so real app errors stay visible during development.
installConsoleFilter();

createRoot(document.getElementById("root")!).render(<App />);
