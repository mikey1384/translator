// Test script to verify if the save-file handler is working
console.log("🧪 TEST-SAVE.JS - STARTING TEST");

const { ipcMain } = require("electron");

// Check if the handler exists
function isHandlerRegistered(channel) {
  try {
    // Attempt to register a temporary handler
    const tempHandler = () => {};
    ipcMain.handle(channel, tempHandler);

    // If successful, remove it immediately and return false (handler did not exist)
    ipcMain.removeHandler(channel);
    return false;
  } catch (error) {
    // If there's an error, assume the channel is already handled (handler exists)
    return true;
  }
}

// Check which handlers are registered
console.log("🧪 TEST-SAVE.JS - Checking if save-file handler is registered");
const saveFileExists = isHandlerRegistered("save-file");
console.log("🧪 TEST-SAVE.JS - save-file handler exists:", saveFileExists);

// Try to get all registered handlers
try {
  const handlers = ipcMain._invokeHandlers;
  if (handlers) {
    const allHandlers = Array.from(handlers.keys());
    console.log("🧪 TEST-SAVE.JS - All registered handlers:", allHandlers);
    console.log(
      "🧪 TEST-SAVE.JS - save-file handler exists in _invokeHandlers:",
      handlers.has("save-file")
    );

    if (handlers.has("save-file")) {
      const saveFileHandler = handlers.get("save-file");
      console.log(
        "🧪 TEST-SAVE.JS - saveFileHandler exists:",
        !!saveFileHandler
      );
    }
  } else {
    console.log("🧪 TEST-SAVE.JS - ipcMain._invokeHandlers not available");
  }
} catch (error) {
  console.error("🧪 TEST-SAVE.JS - Error accessing handlers:", error);
}

// Register a test handler to see if registration works at all
try {
  console.log("🧪 TEST-SAVE.JS - Attempting to register a test handler");
  ipcMain.handle("test-handler", () => "test");
  console.log("🧪 TEST-SAVE.JS - Test handler registered successfully");

  // Check if it actually registered
  const testExists = isHandlerRegistered("test-handler");
  console.log(
    "🧪 TEST-SAVE.JS - test-handler exists after registration:",
    testExists
  );

  // Clean up
  try {
    ipcMain.removeHandler("test-handler");
    console.log("🧪 TEST-SAVE.JS - Test handler removed successfully");
  } catch (err) {
    console.error("🧪 TEST-SAVE.JS - Error removing test handler:", err);
  }
} catch (error) {
  console.error("🧪 TEST-SAVE.JS - Error registering test handler:", error);
}

console.log("🧪 TEST-SAVE.JS - TEST COMPLETED");
