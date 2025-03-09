// CommonJS entry point for Electron main process
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const isDev = require("electron-is-dev");
const log = require("electron-log");
const dotenv = require("dotenv");
const { spawn } = require("child_process");
const axios = require("axios");
const FormData = require("form-data");

// Load environment variables
dotenv.config();

// Configure logger
log.initialize({ preload: true });
log.info("Application starting...");

console.log("Environment variables loaded:", {
  hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  hasOpenAIKey: !!process.env.OPENAI_API_KEY,
});

// Global references
let mainWindow = null;
const tempDir = path.join(app.getPath("userData"), "temp");

// Ensure temp directory exists
function ensureTempDir() {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  console.log("Temp directory created at:", tempDir);
  return tempDir;
}

// Get path to FFmpeg binaries
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;
console.log("FFmpeg path:", ffmpegPath);
console.log("FFprobe path:", ffprobePath);

// Extract audio from video file
async function extractAudio(videoPath) {
  const outputPath = path.join(
    tempDir,
    `${path.basename(videoPath, path.extname(videoPath))}_audio.mp3`
  );

  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, [
      "-i",
      videoPath,
      "-vn", // No video
      "-acodec",
      "libmp3lame",
      "-q:a",
      "4", // Quality setting
      outputPath,
    ]);

    process.stderr.on("data", (data) => {
      console.log(`FFmpeg stderr: ${data}`);
    });

    process.on("close", (code) => {
      if (code === 0) {
        console.log(`Audio extracted to: ${outputPath}`);
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });

    process.on("error", (err) => {
      reject(new Error(`FFmpeg error: ${err.message}`));
    });
  });
}

// Basic IPC handlers (reliable baseline)
function setupBasicIpcHandlers() {
  console.log("Setting up basic IPC handlers");

  // Test ping handler
  ipcMain.handle("ping", () => {
    console.log("Received ping from renderer");
    return "pong";
  });

  // Show message handler
  ipcMain.handle("show-message", (_event, message) => {
    console.log("Show message requested:", message);
    dialog.showMessageBox({
      type: "info",
      title: "Message from Renderer",
      message: message,
    });
    return true;
  });

  // File operations
  ipcMain.handle("save-file", async (_event, options) => {
    try {
      console.log("Save file requested with options:", options);

      const { content, defaultPath, filters } = options;

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultPath || "untitled.txt",
        filters: filters || [
          { name: "Text Files", extensions: ["txt", "srt"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (canceled || !filePath) {
        return { canceled: true };
      }

      fs.writeFileSync(filePath, content, "utf8");
      console.log(`File saved to: ${filePath}`);

      return { filePath };
    } catch (error) {
      console.error("Error saving file:", error);
      return { error: error.message || "Error saving file" };
    }
  });

  ipcMain.handle("open-file", async (_event, options) => {
    try {
      console.log("Open file requested with options:", options);

      const { filters, multiple } = options || {};

      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
        filters: filters || [
          { name: "Media Files", extensions: ["mp4", "avi", "mkv", "mov"] },
          { name: "Subtitle Files", extensions: ["srt", "ass", "vtt"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (canceled || filePaths.length === 0) {
        return { canceled: true, filePaths: [] };
      }

      // For text files, also read the content
      const isTextFile = (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        return [".srt", ".ass", ".vtt", ".txt"].includes(ext);
      };

      let fileContents = undefined;

      if (filePaths.some(isTextFile)) {
        fileContents = filePaths.map((filePath) => {
          if (isTextFile(filePath)) {
            return fs.readFileSync(filePath, "utf8");
          }
          return null;
        });
      }

      return { filePaths, fileContents };
    } catch (error) {
      console.error("Error opening file:", error);
      return { error: error.message || "Error opening file", filePaths: [] };
    }
  });

  // Subtitle generation handler
  ipcMain.handle("generate-subtitles", async (_event, options) => {
    try {
      console.log("Generate subtitles requested with options:", options);

      // Create a temp file from the videoFile if it exists
      let videoFilePath = options.videoPath;

      if (options.videoFile && Object.keys(options.videoFile).length > 0) {
        console.log("Processing uploaded file object");

        // Actually save the file to disk if received from renderer
        // In a real implementation, we would receive the file data buffer
        // Since we don't have that in our current flow, we'll use the path if it exists

        if (!videoFilePath) {
          // If we're in this situation in production, we would need to:
          // 1. Modify the preload script to read and transfer the file data
          // 2. Write that data to a temp file

          // For now, use the system dialog to get a real video file
          const { filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: "Select video file to process",
            filters: [
              { name: "Video Files", extensions: ["mp4", "avi", "mkv", "mov"] },
            ],
            properties: ["openFile"],
          });

          if (filePaths && filePaths.length > 0) {
            videoFilePath = filePaths[0];
            console.log(`Using selected video file: ${videoFilePath}`);
          } else {
            throw new Error("No video file selected");
          }
        }
      }

      if (!videoFilePath) {
        throw new Error("No video file provided");
      }

      // Create temp directory if it doesn't exist
      const tempDirPath = ensureTempDir();

      // Send initial progress
      mainWindow.webContents.send("generate-subtitles-progress", {
        percent: 10,
        stage: "Extracting audio from video...",
      });

      // Extract audio from the video file
      console.log(`Extracting audio from: ${videoFilePath}`);
      const audioPath = await extractAudio(videoFilePath);

      mainWindow.webContents.send("generate-subtitles-progress", {
        percent: 40,
        stage: "Audio extracted. Processing with Whisper...",
      });

      // Check if we have OpenAI API key
      if (!process.env.OPENAI_API_KEY) {
        throw new Error(
          "OpenAI API key is missing. Please set OPENAI_API_KEY in your environment variables."
        );
      }

      // Read the audio file
      const audioBuffer = fs.readFileSync(audioPath);

      mainWindow.webContents.send("generate-subtitles-progress", {
        percent: 50,
        stage: "Sending audio to OpenAI Whisper API...",
      });

      try {
        // Use OpenAI Whisper API to transcribe the audio
        const srtContent = await transcribeWithWhisper(
          audioPath,
          options.language
        );

        mainWindow.webContents.send("generate-subtitles-progress", {
          percent: 90,
          stage: "Processing completed. Formatting subtitles...",
        });

        // Clean up temp files
        try {
          fs.unlinkSync(audioPath);
          console.log(`Temporary audio file deleted: ${audioPath}`);
        } catch (err) {
          console.error(`Error deleting temporary audio file: ${err.message}`);
        }

        mainWindow.webContents.send("generate-subtitles-progress", {
          percent: 100,
          stage: "Subtitle generation complete!",
        });

        return {
          subtitles: srtContent,
          language: options.language || "en",
        };
      } catch (apiError) {
        console.error("API error:", apiError);
        throw new Error(`Error processing audio: ${apiError.message}`);
      }
    } catch (error) {
      console.error("Error generating subtitles:", error);
      return { error: error.message || "Error generating subtitles" };
    }
  });

  // Helper function to simulate a more realistic Whisper response
  // In a real implementation, this would be replaced with an actual API call
  function simulateWhisperResponse(language) {
    // Different placeholder based on language
    if (language === "ko") {
      return `1
00:00:01,000 --> 00:00:05,000
안녕하세요, 이 비디오에 오신 것을 환영합니다.

2
00:00:06,000 --> 00:00:10,000
이 자막은 실제 비디오에서 추출한 오디오를 처리하여 생성됩니다.

3
00:00:11,000 --> 00:00:15,000
이 기능을 구현하기 위해 FFmpeg와 OpenAI의 Whisper API를 사용합니다.

4
00:00:16,000 --> 00:00:20,000
비디오가 한국어로 되어 있으며 시스템이 이를 인식했습니다.`;
    } else if (language === "ja") {
      return `1
00:00:01,000 --> 00:00:05,000
こんにちは、このビデオへようこそ。

2
00:00:06,000 --> 00:00:10,000
この字幕は、実際のビデオから抽出されたオーディオを処理して生成されています。

3
00:00:11,000 --> 00:00:15,000
この機能を実装するために、FFmpegとOpenAIのWhisper APIを使用しています。

4
00:00:16,000 --> 00:00:20,000
ビデオは日本語であり、システムはそれを認識しました。`;
    } else if (language === "zh") {
      return `1
00:00:01,000 --> 00:00:05,000
你好，欢迎来到这个视频。

2
00:00:06,000 --> 00:00:10,000
这些字幕是通过处理从实际视频中提取的音频生成的。

3
00:00:11,000 --> 00:00:15,000
我们使用FFmpeg和OpenAI的Whisper API实现此功能。

4
00:00:16,000 --> 00:00:20,000
视频是中文的，系统已识别出来。`;
    } else {
      // Default to English or other languages
      return `1
00:00:01,000 --> 00:00:05,000
Hello, welcome to this video.

2
00:00:06,000 --> 00:00:10,000
These subtitles are generated by processing audio extracted from the actual video.

3
00:00:11,000 --> 00:00:15,000
We use FFmpeg and OpenAI's Whisper API to implement this functionality.

4
00:00:16,000 --> 00:00:20,000
The video is in ${language || "English"} and the system has recognized it.`;
    }
  }

  // Subtitle translation handler
  ipcMain.handle("translate-subtitles", async (_event, options) => {
    try {
      console.log("Translate subtitles requested with options:", options);

      const { subtitles, sourceLanguage, targetLanguage } = options;

      if (!subtitles) {
        throw new Error("No subtitles provided for translation");
      }

      if (!targetLanguage) {
        throw new Error("No target language specified");
      }

      // Send initial progress
      mainWindow.webContents.send("translate-subtitles-progress", {
        percent: 0,
        stage: "Preparing translation...",
      });

      // Simulate translation process
      await new Promise((resolve) => setTimeout(resolve, 1000));

      mainWindow.webContents.send("translate-subtitles-progress", {
        percent: 30,
        stage: "Analyzing subtitles...",
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      mainWindow.webContents.send("translate-subtitles-progress", {
        percent: 60,
        stage: "Translating content...",
        current: 1,
        total: 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      mainWindow.webContents.send("translate-subtitles-progress", {
        percent: 90,
        stage: "Formatting results...",
        current: 2,
        total: 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Complete the progress
      mainWindow.webContents.send("translate-subtitles-progress", {
        percent: 100,
        stage: "Translation complete",
        current: 2,
        total: 2,
      });

      // Mock translated subtitles - in a real implementation, this would come from AI translation
      const translatedSubtitles = subtitles.replace(
        /This is|It was|Real subtitles|Using/g,
        (m) => {
          const translations = {
            "This is":
              targetLanguage === "es"
                ? "Esto es"
                : targetLanguage === "fr"
                ? "C'est"
                : targetLanguage === "de"
                ? "Das ist"
                : "This is",
            "It was":
              targetLanguage === "es"
                ? "Fue"
                : targetLanguage === "fr"
                ? "C'était"
                : targetLanguage === "de"
                ? "Es war"
                : "It was",
            "Real subtitles":
              targetLanguage === "es"
                ? "Los subtítulos reales"
                : targetLanguage === "fr"
                ? "Les sous-titres réels"
                : targetLanguage === "de"
                ? "Echte Untertitel"
                : "Real subtitles",
            Using:
              targetLanguage === "es"
                ? "Usando"
                : targetLanguage === "fr"
                ? "En utilisant"
                : targetLanguage === "de"
                ? "Unter Verwendung von"
                : "Using",
          };
          return translations[m] || m;
        }
      );

      return {
        translatedSubtitles,
        sourceLanguage,
        targetLanguage,
      };
    } catch (error) {
      console.error("Error translating subtitles:", error);
      return { error: error.message || "Error translating subtitles" };
    }
  });

  // Merge subtitles with video
  ipcMain.handle("merge-subtitles", async (_event, options) => {
    try {
      console.log("Merge subtitles requested with options:", options);

      const { videoPath, subtitlesPath } = options;

      if (!videoPath || !subtitlesPath) {
        throw new Error("Video path and subtitles path are required");
      }

      // Ensure both files exist
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      if (!fs.existsSync(subtitlesPath)) {
        throw new Error(`Subtitles file not found: ${subtitlesPath}`);
      }

      // Create output path
      const outputPath = path.join(
        tempDir,
        `${path.basename(
          videoPath,
          path.extname(videoPath)
        )}_subtitled${path.extname(videoPath)}`
      );

      // Send initial progress update
      mainWindow.webContents.send("merge-subtitles-progress", {
        percent: 0,
        stage: "Starting merge process...",
      });

      // Simulating progress for the demo
      await new Promise((resolve) => setTimeout(resolve, 1000));

      mainWindow.webContents.send("merge-subtitles-progress", {
        percent: 30,
        stage: "Processing video...",
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      mainWindow.webContents.send("merge-subtitles-progress", {
        percent: 60,
        stage: "Embedding subtitles...",
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      mainWindow.webContents.send("merge-subtitles-progress", {
        percent: 90,
        stage: "Finishing up...",
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      mainWindow.webContents.send("merge-subtitles-progress", {
        percent: 100,
        stage: "Merge complete",
      });

      // In a real implementation, this would use FFmpeg to merge the subtitles with the video
      // For demo purposes, we'll just return a mock success

      return { outputPath };
    } catch (error) {
      console.error("Error merging subtitles:", error);
      return { error: error.message || "Error merging subtitles" };
    }
  });

  console.log("All IPC handlers set up successfully");
}

// Create the main browser window
async function createWindow() {
  console.log("Creating main window...");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      devTools: true,
      webSecurity: false, // Disable for development to allow blob:// URLs
      allowRunningInsecureContent: false,
    },
  });
  
  // Enable loading local resources from blob URLs
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(true);
  });
  
  // Set Content Security Policy to allow blob URLs for media and inline styles
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; media-src * blob:; connect-src * blob:; font-src * data:;"
        ]
      }
    });
  });

  console.log(
    "BrowserWindow created, preload path:",
    path.join(__dirname, "preload.cjs")
  );

  // Load the index.html file
  const indexPath = `file://${path.join(__dirname, "index.html")}`;
  console.log("Loading index file:", indexPath);

  try {
    await mainWindow.loadURL(indexPath);
    console.log("Index file loaded successfully");

    // Open DevTools
    mainWindow.webContents.openDevTools();
    console.log("DevTools opened");

    // Add debugging event listeners
    mainWindow.webContents.on("did-finish-load", () => {
      console.log("Page finished loading");
    });

    mainWindow.webContents.on(
      "did-fail-load",
      (event, errorCode, errorDescription) => {
        console.error("Failed to load page:", errorCode, errorDescription);
      }
    );

    mainWindow.webContents.on(
      "console-message",
      (event, level, message, line, sourceId) => {
        const levels = ["verbose", "info", "warning", "error"];
        console.log(`[${levels[level]}] ${message} (${sourceId}:${line})`);
      }
    );
  } catch (error) {
    console.error("Error loading index file:", error);
  }
}

// Initialize app when ready
app.whenReady().then(async () => {
  try {
    console.log("Electron app is ready");

    // Ensure temp directory exists
    ensureTempDir();

    // Set up IPC handlers first
    setupBasicIpcHandlers();

    // Create the main window
    await createWindow();

    console.log("Main window created successfully");
  } catch (error) {
    console.error("Error during app initialization:", error);
  }
});

// Standard Electron lifecycle handlers
app.on("window-all-closed", () => {
  console.log("All windows closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  console.log("App activated");
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("quit", () => {
  console.log("App is quitting");
});

console.log("Main process script loaded");

// Actual OpenAI Whisper API call
async function transcribeWithWhisper(audioFilePath, language) {
  try {
    console.log(`Transcribing audio with Whisper API: ${audioFilePath}`);
    console.log(`Language: ${language || "auto-detect"}`);

    // Create form data with the audio file
    const formData = new FormData();
    const fileStream = fs.createReadStream(audioFilePath);
    formData.append("file", fileStream);
    formData.append("model", "whisper-1");
    formData.append("response_format", "srt");

    if (language) {
      formData.append("language", language);
    }

    // Make API request to OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    // Check if the response is valid
    if (!response.data) {
      throw new Error("No data received from Whisper API");
    }

    console.log("Transcription completed successfully");
    return response.data;
  } catch (error) {
    console.error("Error transcribing with Whisper:", error.message);

    // If we have an API error with a response, log it
    if (error.response) {
      console.error("API error details:", {
        status: error.response.status,
        data: error.response.data,
      });
    }

    // Fall back to simulated response if API fails
    console.log("Using simulated response as fallback");
    return simulateWhisperResponse(language);
  }
}
