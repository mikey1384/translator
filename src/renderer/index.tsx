import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App/index.js';

// React root reference for potential hot reloading
let root: ReturnType<typeof createRoot> | null = null;

const renderApp = () => {
  const container = document.getElementById('root');
  if (!container) return;

  // Clear any existing content in the root element
  const loadingElement = container.querySelector('.loading');
  if (loadingElement) {
    container.removeChild(loadingElement);
  }

  // Create a root for React if it doesn't exist
  if (!root) {
    root = createRoot(container);
  }

  // Render the App component
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

// Initial render
renderApp();
