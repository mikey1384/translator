import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

console.log("Renderer entry point loaded");

// React root reference for potential hot reloading
let root: ReturnType<typeof createRoot> | null = null;

const renderApp = () => {
  const container = document.getElementById("root");
  if (!container) {
    console.error("Root element not found");
    return;
  }

  // Clear any existing content in the root element
  const loadingElement = container.querySelector(".loading");
  if (loadingElement) {
    console.log("Removing loading element");
    container.removeChild(loadingElement);
  }

  // Create a root for React if it doesn't exist
  if (!root) {
    root = createRoot(container);
  }

  // Render the App component
  console.log("Rendering React App");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

// Initial render
renderApp();
