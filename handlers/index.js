// HANDLERS/INDEX.JS
// Require all handlers to ensure they are registered early in the application lifecycle

console.log("Initializing handlers...");

// Core handlers
require("./message-handler");

// File operation handlers
require("./save-handler");
require("./file-handler");

// Subtitle processing handlers
require("./subtitle-handlers");

console.log("All handlers initialized");

// Export a function to verify handlers are working
module.exports = {
  isInitialized: true,
};
