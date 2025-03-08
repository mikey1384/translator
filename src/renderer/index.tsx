import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

console.log("Renderer entry point loaded");

const container = document.getElementById("root");
if (container) {
  // Clear any existing content in the root element
  const loadingElement = container.querySelector(".loading");
  if (loadingElement) {
    console.log("Removing loading element");
    container.removeChild(loadingElement);
  }

  // Create a root for React
  const root = createRoot(container);

  // Render the App component
  console.log("Rendering React App");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("Root element not found");
}
