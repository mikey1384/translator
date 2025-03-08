import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Wait for the DOM to be ready
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("app");
  if (!container) {
    throw new Error("Root element not found");
  }

  const root = createRoot(container);
  root.render(<App />);
});
