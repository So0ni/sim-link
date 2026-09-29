import { startPwa } from "./pwa/controller.ts";
import { PwaUpdateNotice } from "./pwa/PwaControls.tsx";
import React from "react";
import { createRoot } from "react-dom/client";
import tokens from "../../../design/tokens/tokens.json";
import "./styles.css";
import "./app/live.css";
Object.entries(tokens.color).forEach(([key, value]) =>
  document.documentElement.style.setProperty(`--${key}`, value),
);
document.documentElement.style.setProperty("--font", tokens.font.webSans);
// Build-time separation: production never falls back to fictional messages or demo auth.
async function mount() {
  const pwaEnabled = import.meta.env.PROD && import.meta.env.VITE_SIMLINK_DEMO !== "1";
  if (pwaEnabled) startPwa();
  const App =
    import.meta.env.VITE_SIMLINK_DEMO === "1"
      ? (await import("./demo/DemoApp.tsx")).DemoApp
      : (await import("./app/App.tsx")).App;
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
      {pwaEnabled && <PwaUpdateNotice />}
    </React.StrictMode>,
  );
}
void mount();
