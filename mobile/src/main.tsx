import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AppProvider, createApp } from "./core";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);
createApp().then(async (controller) => {
  await controller.start();
  root.render(
    <StrictMode>
      <AppProvider controller={controller}><App /></AppProvider>
    </StrictMode>,
  );
});
