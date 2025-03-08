import React, { useState } from "react";

// Define the window interface to access our Electron API
declare global {
  interface Window {
    electron: {
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

const App: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, stage: "" });

  // This is a placeholder UI - we'll build the real UI later
  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>Subtitle Translator</h1>

      <div style={{ marginBottom: "2rem" }}>
        <h2>Select Video</h2>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setSelectedFile(files[0]);
            }
          }}
        />
      </div>

      {selectedFile && (
        <div>
          <h3>Selected File: {selectedFile.name}</h3>
          <button
            disabled={isProcessing}
            onClick={async () => {
              setIsProcessing(true);

              // This is where we would call our Electron API
              // For now, just simulate progress
              let percent = 0;
              const interval = setInterval(() => {
                percent += 5;
                setProgress({ percent, stage: "Processing video..." });
                if (percent >= 100) {
                  clearInterval(interval);
                  setIsProcessing(false);
                  setProgress({ percent: 100, stage: "Complete!" });
                }
              }, 500);
            }}
          >
            Generate Subtitles
          </button>
        </div>
      )}

      {isProcessing && (
        <div style={{ marginTop: "2rem" }}>
          <h3>Progress: {progress.percent}%</h3>
          <p>{progress.stage}</p>
          <div
            style={{
              width: "100%",
              height: "20px",
              backgroundColor: "#eee",
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress.percent}%`,
                height: "100%",
                backgroundColor: "#4361ee",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
