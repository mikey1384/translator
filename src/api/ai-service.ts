import { Anthropic } from "@anthropic-ai/sdk";
import { OpenAI } from "openai";
import log from "electron-log";
import fs from "fs";
import { FFmpegService } from "../electron/ffmpeg-service";
import path from "path";

export class AIServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIServiceError";
  }
}

export class AIService {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;
  private ffmpegService: FFmpegService;

  constructor() {
    // Initialize FFmpeg service
    this.ffmpegService = new FFmpegService();

    // Initialize Anthropic client if API key is available
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      log.info("Anthropic API client initialized");
    } else {
      log.warn("Anthropic API key not found in environment variables");
    }

    // Initialize OpenAI client if API key is available
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      log.info("OpenAI API client initialized");
    } else {
      log.warn("OpenAI API key not found in environment variables");
    }
  }

  /**
   * Generate subtitles from audio file, matching WebsiteVersionServer implementation
   */
  async generateSubtitlesFromAudio(
    inputAudioPath: string,
    targetLanguage: string = "original",
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<string> {
    try {
      if (!this.openai) {
        throw new AIServiceError("OpenAI client not initialized");
      }

      if (!fs.existsSync(inputAudioPath)) {
        throw new AIServiceError(`Audio file not found: ${inputAudioPath}`);
      }

      // Report initial progress
      if (progressCallback) {
        progressCallback({
          percent: 0,
          stage: "Starting transcription process",
        });
      }

      // Get file size
      const fileSize = fs.statSync(inputAudioPath).size;
      const MAX_CHUNK_SIZE = 20 * 1024 * 1024; // 20MB, safely below 25MB limit
      let allSegments: any[] = [];

      if (progressCallback) {
        progressCallback({ percent: 5, stage: "Analyzing audio file" });
      }

      if (fileSize <= MAX_CHUNK_SIZE) {
        // Small file - process as a whole
        if (progressCallback) {
          progressCallback({ percent: 10, stage: "Transcribing audio" });
        }

        let response: any;
        if (targetLanguage === "original") {
          response = await this.openai.audio.transcriptions.create({
            file: await this.createFileFromPath(inputAudioPath),
            model: "whisper-1",
            response_format: "verbose_json",
          });
        } else {
          response = await this.openai.audio.translations.create({
            file: await this.createFileFromPath(inputAudioPath),
            model: "whisper-1",
            response_format: "verbose_json",
          });
        }

        allSegments = response.segments || [];

        if (progressCallback) {
          progressCallback({
            percent: 85,
            stage: "Processing transcription data",
          });
        }
      } else {
        // Large file - need to chunk it
        if (progressCallback) {
          progressCallback({
            percent: 10,
            stage: "Preparing to split large audio file",
          });
        }

        // Get audio duration using ffprobe
        const duration = await this.ffmpegService.getMediaDuration(
          inputAudioPath
        );

        // Calculate chunks
        const bitrate = fileSize / duration; // bytes per second
        const chunkDuration = MAX_CHUNK_SIZE / bitrate; // seconds per chunk
        const numChunks = Math.ceil(duration / chunkDuration);
        const chunkPaths: string[] = [];

        if (progressCallback) {
          progressCallback({
            percent: 15,
            stage: `Splitting audio into ${numChunks} chunks`,
          });
        }

        // Get temporary directory
        const tempDir = path.dirname(inputAudioPath);

        // Split audio into chunks
        for (let i = 0; i < numChunks; i++) {
          const startTime = i * chunkDuration;
          const chunkPath = path.join(tempDir, `chunk_${Date.now()}_${i}.mp3`);

          if (progressCallback) {
            progressCallback({
              percent: 15 + (i / numChunks) * 15,
              stage: `Creating chunk ${i + 1} of ${numChunks}`,
            });
          }

          await this.ffmpegService.extractAudioSegment(
            inputAudioPath,
            chunkPath,
            startTime,
            chunkDuration
          );

          chunkPaths.push(chunkPath);
        }

        // Transcribe each chunk
        let transcriptionProgress = 30; // Start at 30%
        const progressPerChunk = 50 / numChunks; // 30% to 80% is 50%

        for (let i = 0; i < chunkPaths.length; i++) {
          const chunkPath = chunkPaths[i];
          const chunkStartTime = i * chunkDuration;

          if (progressCallback) {
            progressCallback({
              percent: transcriptionProgress,
              stage: `Transcribing chunk ${i + 1} of ${numChunks}`,
            });
          }

          // Transcribe or translate the chunk
          let chunkResponse: any;
          if (targetLanguage === "original") {
            chunkResponse = await this.openai.audio.transcriptions.create({
              file: await this.createFileFromPath(chunkPath),
              model: "whisper-1",
              response_format: "verbose_json",
            });
          } else {
            chunkResponse = await this.openai.audio.translations.create({
              file: await this.createFileFromPath(chunkPath),
              model: "whisper-1",
              response_format: "verbose_json",
            });
          }

          const chunkSegments = chunkResponse.segments || [];

          // Adjust timestamps based on chunk start time
          for (const segment of chunkSegments) {
            segment.start += chunkStartTime;
            segment.end += chunkStartTime;
          }

          allSegments.push(...chunkSegments);

          // Update progress
          transcriptionProgress += progressPerChunk;

          // Clean up chunk file
          try {
            fs.unlinkSync(chunkPath);
          } catch (err) {
            log.error(`Failed to delete chunk ${chunkPath}:`, err);
          }
        }
      }

      // Convert segments to SRT format
      if (progressCallback) {
        progressCallback({ percent: 90, stage: "Generating SRT file" });
      }

      const srtContent = this.convertSegmentsToSrt(allSegments);

      if (progressCallback) {
        progressCallback({ percent: 100, stage: "Transcription complete" });
      }

      return srtContent;
    } catch (error) {
      log.error("Error generating subtitles from audio:", error);
      throw new AIServiceError(`Failed to generate subtitles: ${error}`);
    }
  }

  /**
   * Translate text using Claude model
   */
  async translateText(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    progressCallback?: (progress: { percent: number; stage: string }) => void
  ): Promise<string> {
    try {
      if (!this.anthropic) {
        throw new AIServiceError("Anthropic client not initialized");
      }

      if (progressCallback) {
        progressCallback({ percent: 0, stage: "Starting translation" });
      }

      log.info(`Translating text from ${sourceLanguage} to ${targetLanguage}`);

      // Check if text is too long and needs to be chunked
      const MAX_TEXT_LENGTH = 30000; // Claude context limit is larger but we'll be conservative

      if (text.length <= MAX_TEXT_LENGTH) {
        // Regular translation for shorter texts
        if (progressCallback) {
          progressCallback({ percent: 10, stage: "Translating subtitles" });
        }

        const message = await this.anthropic.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 4000,
          system: `You are a professional subtitle translator. Translate the following subtitles from ${sourceLanguage} to ${targetLanguage}. 
                  Maintain the original format and structure, including all line breaks.
                  Ensure that each subtitle maintains its original timing and structure.
                  Do not add any additional text or explanations.`,
          messages: [
            {
              role: "user",
              content: text,
            },
          ],
        });

        if (progressCallback) {
          progressCallback({ percent: 90, stage: "Processing translation" });
        }

        if (message.content[0].type === "text") {
          if (progressCallback) {
            progressCallback({ percent: 100, stage: "Translation complete" });
          }
          return message.content[0].text;
        } else {
          throw new AIServiceError(
            "Unexpected response format from Anthropic API"
          );
        }
      } else {
        // Handle large SRT files by splitting into chunks based on subtitle blocks
        if (progressCallback) {
          progressCallback({
            percent: 10,
            stage: "Preparing large subtitle file for translation",
          });
        }

        // Split SRT into blocks by double newline
        const subtitleBlocks = text.split("\n\n");
        const totalBlocks = subtitleBlocks.length;

        // Create batches of blocks
        const BATCH_SIZE = 20; // Process 20 blocks at a time
        const batches = [];

        for (let i = 0; i < totalBlocks; i += BATCH_SIZE) {
          batches.push(subtitleBlocks.slice(i, i + BATCH_SIZE));
        }

        let translatedBlocks: string[] = [];
        const totalBatches = batches.length;

        // Process each batch
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const batch = batches[batchIndex];
          const batchText = batch.join("\n\n");

          if (progressCallback) {
            const progressPercent = 10 + (batchIndex / totalBatches) * 80;
            progressCallback({
              percent: progressPercent,
              stage: `Translating batch ${batchIndex + 1} of ${totalBatches}`,
            });
          }

          const message = await this.anthropic.messages.create({
            model: "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            system: `You are a professional subtitle translator. Translate the following subtitles from ${sourceLanguage} to ${targetLanguage}. 
                    Maintain the original format and structure, including all line breaks and numbering.
                    Ensure that each subtitle maintains its original timing and structure.
                    Do not add any additional text or explanations.`,
            messages: [
              {
                role: "user",
                content: batchText,
              },
            ],
          });

          if (message.content[0].type === "text") {
            // Add the translated batch to our results
            translatedBlocks.push(message.content[0].text);
          } else {
            throw new AIServiceError(
              "Unexpected response format from Anthropic API"
            );
          }
        }

        if (progressCallback) {
          progressCallback({
            percent: 90,
            stage: "Combining translated subtitles",
          });
        }

        // Combine all translated blocks
        const translatedSRT = translatedBlocks.join("\n\n");

        if (progressCallback) {
          progressCallback({ percent: 100, stage: "Translation complete" });
        }

        return translatedSRT;
      }
    } catch (error) {
      log.error("Error translating text:", error);
      throw new AIServiceError(`Failed to translate text: ${error}`);
    }
  }

  /**
   * Convert segments to SRT format
   */
  private convertSegmentsToSrt(segments: any[]): string {
    let srtContent = "";

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const index = i + 1;
      const startTime = this.formatSrtTimestamp(segment.start);
      const endTime = this.formatSrtTimestamp(segment.end);
      const text = segment.text.trim();

      srtContent += `${index}\n${startTime} --> ${endTime}\n${text}\n\n`;
    }

    return srtContent.trim();
  }

  /**
   * Format timestamp for SRT format
   */
  private formatSrtTimestamp(seconds: number): string {
    const ms = Math.floor((seconds % 1) * 1000);
    let sec = Math.floor(seconds);
    let mins = Math.floor(sec / 60);
    sec %= 60;
    const hours = Math.floor(mins / 60);
    mins %= 60;

    return `${hours.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${sec.toString().padStart(2, "0")},${ms
      .toString()
      .padStart(3, "0")}`;
  }

  /**
   * Create a File object from a file path
   */
  private async createFileFromPath(filePath: string): Promise<File> {
    try {
      // Get file details
      const fileName = path.basename(filePath);
      const fileStats = fs.statSync(filePath);
      const fileData = fs.readFileSync(filePath);

      // Create a File object
      return new File([fileData], fileName, {
        type: this.getMimeType(filePath),
        lastModified: fileStats.mtimeMs,
      });
    } catch (error) {
      log.error("Error creating file from path:", error);
      throw new AIServiceError(`Failed to create file from path: ${error}`);
    }
  }

  /**
   * Get MIME type based on file extension
   */
  private getMimeType(filePath: string): string {
    const extension = filePath.split(".").pop()?.toLowerCase();

    switch (extension) {
      case "mp3":
        return "audio/mpeg";
      case "mp4":
        return "audio/mp4";
      case "wav":
        return "audio/wav";
      case "m4a":
        return "audio/mp4";
      default:
        return "application/octet-stream";
    }
  }
}
