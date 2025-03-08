import React, { useEffect, useState } from "react";

// Define the window interface to access our Electron API
declare global {
  interface Window {
    electron: {
      // Test methods
      ping: () => Promise<string>;
      showMessage: (message: string) => Promise<boolean>;
      test: () => string;

      // Main app methods
      generateSubtitles: (options: any) => Promise<any>;
      onGenerateSubtitlesProgress: (callback: (progress: any) => void) => void;
      translateSubtitles: (options: any) => Promise<any>;
      onTranslateSubtitlesProgress: (callback: (progress: any) => void) => void;
      mergeSubtitles: (options: any) => Promise<any>;
      onMergeSubtitlesProgress: (callback: (progress: any) => void) => void;
      saveFile: (options: any) => Promise<any>;
      openFile: (options: any) => Promise<any>;
    };
  }
}

// Main App component
const App: React.FC = () => {
  const [loaded, setLoaded] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [pingResponse, setPingResponse] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    console.log("React App component mounted");

    // Set loaded to true to indicate the component did mount
    setLoaded(true);

    // Check if Electron API is available
    const hasApi = typeof window.electron !== "undefined";
    setApiAvailable(hasApi);

    if (hasApi) {
      // Test the ping function
      window.electron
        .ping()
        .then((response) => {
          console.log("Ping response in React:", response);
          setPingResponse(response);
        })
        .catch((error) => {
          console.error("Ping error in React:", error);
          setPingResponse(`Error: ${error.message}`);
        });
    }
  }, []);

  const sendMessage = () => {
    if (message && window.electron) {
      window.electron
        .showMessage(message)
        .then((success) => {
          console.log("Message shown:", success);
          if (success) setMessage(""); // Clear input on success
        })
        .catch((error) => {
          console.error("Failed to show message:", error);
        });
    }
  };

  return (
    <div
      style={{
        maxWidth: "800px",
        margin: "0 auto",
        padding: "2rem",
        backgroundColor: "white",
        borderRadius: "8px",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.1)",
      }}
    >
      <h1 style={{ marginBottom: "1rem", color: "#333" }}>Translator App</h1>

      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>
          System Status
        </h2>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            backgroundColor: "#f5f5f5",
            padding: "1rem",
            borderRadius: "4px",
          }}
        >
          <div>
            <span style={{ fontWeight: "bold" }}>React Loaded:</span>
            <span
              style={{
                color: loaded ? "green" : "red",
                marginLeft: "0.5rem",
              }}
            >
              {loaded ? "✓" : "✗"}
            </span>
          </div>

          <div>
            <span style={{ fontWeight: "bold" }}>Electron API Available:</span>
            <span
              style={{
                color: apiAvailable ? "green" : "red",
                marginLeft: "0.5rem",
              }}
            >
              {apiAvailable ? "✓" : "✗"}
            </span>
          </div>

          <div>
            <span style={{ fontWeight: "bold" }}>IPC Connection Test:</span>
            <span
              style={{
                color: pingResponse === "pong" ? "green" : "red",
                marginLeft: "0.5rem",
              }}
            >
              {pingResponse === "pong" ? "✓" : "✗"}
              {pingResponse && ` (${pingResponse})`}
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>
          Test IPC Communication
        </h2>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter a message to send to main process"
              style={{
                flex: 1,
                padding: "0.5rem",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!message || !apiAvailable}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor:
                  message && apiAvailable ? "#1976d2" : "#cccccc",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: message && apiAvailable ? "pointer" : "not-allowed",
              }}
            >
              Send Message
            </button>
          </div>
          <p style={{ fontSize: "0.9rem", color: "#666" }}>
            This will display a native dialog with your message via the main
            process.
          </p>
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>
          Application Ready
        </h2>
        <p style={{ color: "#666" }}>
          The Electron application is running correctly. You can now implement
          the full functionality.
        </p>
      </div>
    </div>
  );
};

export default App;
