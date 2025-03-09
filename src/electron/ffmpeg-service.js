"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FFmpegService = exports.FFmpegError = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
const electron_log_1 = __importDefault(require("electron-log"));
const ffmpeg_1 = __importDefault(require("@ffmpeg-installer/ffmpeg"));
const ffprobe_1 = __importDefault(require("@ffprobe-installer/ffprobe"));
const os_1 = __importDefault(require("os"));
class FFmpegError extends Error {
    constructor(message) {
        super(message);
        this.name = "FFmpegError";
    }
}
exports.FFmpegError = FFmpegError;
class FFmpegService {
    ffmpegPath;
    ffprobePath;
    tempDir;
    constructor() {
        this.ffmpegPath = ffmpeg_1.default.path;
        this.ffprobePath = ffprobe_1.default.path;
        // Safely get a temp directory - use app.getPath if available, otherwise use OS temp dir
        try {
            this.tempDir = path_1.default.join(electron_1.app.getPath("userData"), "temp");
        }
        catch (error) {
            // Fallback to OS temp directory if app is not ready yet
            electron_log_1.default.warn("Electron app not ready, using OS temp directory as fallback");
            this.tempDir = path_1.default.join(os_1.default.tmpdir(), "translator-electron-temp");
        }
        // Ensure temp directory exists
        if (!fs_1.default.existsSync(this.tempDir)) {
            fs_1.default.mkdirSync(this.tempDir, { recursive: true });
        }
        electron_log_1.default.info(`FFmpeg path: ${this.ffmpegPath}`);
        electron_log_1.default.info(`FFprobe path: ${this.ffprobePath}`);
        electron_log_1.default.info(`Temp directory: ${this.tempDir}`);
    }
    /**
     * Extract audio from a video file
     */
    async extractAudio(videoPath) {
        const outputPath = path_1.default.join(this.tempDir, `${path_1.default.basename(videoPath, path_1.default.extname(videoPath))}_audio.mp3`);
        try {
            await this.runFFmpeg([
                "-i",
                videoPath,
                "-vn", // No video
                "-acodec",
                "libmp3lame",
                "-q:a",
                "4", // Quality setting
                outputPath,
            ]);
            return outputPath;
        }
        catch (error) {
            electron_log_1.default.error("Error extracting audio:", error);
            throw new FFmpegError(`Failed to extract audio: ${error}`);
        }
    }
    /**
     * Get the duration of a media file in seconds
     */
    async getMediaDuration(filePath) {
        return new Promise((resolve, reject) => {
            const process = (0, child_process_1.spawn)(this.ffprobePath, [
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                filePath,
            ]);
            let output = "";
            process.stdout.on("data", (data) => {
                output += data.toString();
            });
            process.on("close", (code) => {
                if (code === 0) {
                    const duration = parseFloat(output.trim());
                    if (isNaN(duration)) {
                        reject(new FFmpegError("Could not parse media duration"));
                    }
                    else {
                        resolve(duration);
                    }
                }
                else {
                    reject(new FFmpegError(`FFprobe process exited with code ${code}`));
                }
            });
            process.on("error", (err) => {
                reject(new FFmpegError(`FFprobe error: ${err.message}`));
            });
        });
    }
    /**
     * Merge subtitles with a video file
     */
    async mergeSubtitlesWithVideo(videoPath, subtitlesPath, progressCallback) {
        const outputPath = path_1.default.join(this.tempDir, `${path_1.default.basename(videoPath, path_1.default.extname(videoPath))}_subtitled${path_1.default.extname(videoPath)}`);
        try {
            // First get the duration for progress calculation
            const duration = await this.getMediaDuration(videoPath);
            // Then merge the subtitles
            await this.runFFmpeg([
                "-i",
                videoPath,
                "-i",
                subtitlesPath,
                "-c:v",
                "copy",
                "-c:a",
                "copy",
                "-c:s",
                "mov_text",
                "-metadata:s:s:0",
                "language=eng",
                outputPath,
            ], duration, progressCallback);
            return outputPath;
        }
        catch (error) {
            electron_log_1.default.error("Error merging subtitles:", error);
            throw new FFmpegError(`Failed to merge subtitles: ${error}`);
        }
    }
    /**
     * Merge subtitles with a video file and specify the output path
     */
    async mergeSubtitles(videoPath, subtitlesPath, outputPath, progressCallback) {
        try {
            // First get the duration for progress calculation
            const duration = await this.getMediaDuration(videoPath);
            // Then merge the subtitles
            await this.runFFmpeg([
                "-i",
                videoPath,
                "-i",
                subtitlesPath,
                "-c:v",
                "copy",
                "-c:a",
                "copy",
                "-c:s",
                "mov_text",
                "-metadata:s:s:0",
                "language=eng",
                outputPath,
            ], duration, (progress) => {
                if (progressCallback) {
                    progressCallback({
                        percent: progress,
                        stage: "Merging subtitles with video",
                    });
                }
            });
            return outputPath;
        }
        catch (error) {
            electron_log_1.default.error("Error merging subtitles:", error);
            throw new FFmpegError(`Failed to merge subtitles: ${error}`);
        }
    }
    /**
     * Convert SRT subtitles to ASS format
     */
    async convertSrtToAss(srtPath) {
        const outputPath = path_1.default.join(this.tempDir, `${path_1.default.basename(srtPath, path_1.default.extname(srtPath))}.ass`);
        try {
            await this.runFFmpeg(["-i", srtPath, outputPath]);
            return outputPath;
        }
        catch (error) {
            electron_log_1.default.error("Error converting SRT to ASS:", error);
            throw new FFmpegError(`Failed to convert SRT to ASS: ${error}`);
        }
    }
    /**
     * Run FFmpeg with the given arguments
     */
    runFFmpeg(args, totalDuration, progressCallback) {
        return new Promise((resolve, reject) => {
            const process = (0, child_process_1.spawn)(this.ffmpegPath, args);
            let output = "";
            process.stderr.on("data", (data) => {
                const dataStr = data.toString();
                output += dataStr;
                // Parse progress information if callback provided
                if (progressCallback && totalDuration) {
                    const timeMatch = dataStr.match(/time=(\d+):(\d+):(\d+.\d+)/);
                    if (timeMatch) {
                        const hours = parseInt(timeMatch[1]);
                        const minutes = parseInt(timeMatch[2]);
                        const seconds = parseFloat(timeMatch[3]);
                        const currentTime = hours * 3600 + minutes * 60 + seconds;
                        const progressPercent = Math.min(100, Math.round((currentTime / totalDuration) * 100));
                        progressCallback(progressPercent);
                    }
                }
            });
            process.on("close", (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new FFmpegError(`FFmpeg process exited with code ${code}: ${output}`));
                }
            });
            process.on("error", (err) => {
                reject(new FFmpegError(`FFmpeg error: ${err.message}`));
            });
        });
    }
    /**
     * Extract a segment of audio from a file
     */
    async extractAudioSegment(inputPath, outputPath, startTime, duration) {
        return new Promise((resolve, reject) => {
            const process = (0, child_process_1.spawn)(this.ffmpegPath, [
                "-i",
                inputPath,
                "-ss",
                startTime.toString(),
                "-t",
                duration.toString(),
                "-acodec",
                "libmp3lame",
                "-q:a",
                "4",
                outputPath,
            ]);
            process.on("close", (code) => {
                if (code === 0) {
                    resolve(outputPath);
                }
                else {
                    reject(new FFmpegError(`Failed to extract audio segment, process exited with code ${code}`));
                }
            });
            process.on("error", (err) => {
                reject(new FFmpegError(`Error extracting audio segment: ${err.message}`));
            });
        });
    }
}
exports.FFmpegService = FFmpegService;
//# sourceMappingURL=ffmpeg-service.js.map