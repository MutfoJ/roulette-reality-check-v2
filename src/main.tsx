import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "uplot/dist/uPlot.min.css";
import { registerSW } from "virtual:pwa-register";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker for offline / installable PWA.
// `autoUpdate` mode applies new versions on the next page load — no prompt UI needed.
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}
