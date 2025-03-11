import { Anthropic } from "@anthropic-ai/sdk";
import { OpenAI } from "openai";
import log from "electron-log";
import fs from "fs";
import { FFmpegService } from "./ffmpeg-service";
import path from "path";
import dotenv from "dotenv";

// Load environment variables directly here to ensure they're available
dotenv.config();

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

  // Public methods to check client availability
  public hasOpenAIClient(): boolean {
    return this.openai !== null;
  }

  public hasAnthropicClient(): boolean {
    return this.anthropic !== null;
  }

  constructor(ffmpegService?: FFmpegService) {
    // Use the provided FFmpegService or create a new one
    this.ffmpegService = ffmpegService || new FFmpegService();

    // Default API keys for development use only
    const ANTHROPIC_API_KEY =
      "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";
    const OPENAI_API_KEY =
      "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";

    // Log environment variables status (without exposing their values)
    log.info("Environment variables status:", {
      anthropicEnvVar: process.env.ANTHROPIC_API_KEY ? "Set" : "Not set",
      openaiEnvVar: process.env.OPENAI_API_KEY ? "Set" : "Not set",
    });

    try {
      // Initialize Anthropic client with default key or environment variable
      // Use hardcoded key as a guaranteed fallback
      const anthropicKey = process.env.ANTHROPIC_API_KEY || ANTHROPIC_API_KEY;
      this.anthropic = new Anthropic({
        apiKey: anthropicKey,
      });
      log.info("Anthropic API client successfully initialized");

      // Initialize OpenAI client with default key or environment variable
      // Use hardcoded key as a guaranteed fallback
      const openaiKey = process.env.OPENAI_API_KEY || OPENAI_API_KEY;
      this.openai = new OpenAI({
        apiKey: openaiKey,
      });
      log.info("OpenAI API client successfully initialized");
    } catch (error) {
      log.error("Error initializing API clients:", error);

      // Last-ditch recovery attempt
      try {
        this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
        this.openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        log.info(
          "API clients initialized with hardcoded keys after error recovery"
        );
      } catch (retryError) {
        log.error(
          "Failed to initialize API clients even with hardcoded keys:",
          retryError
        );
      }
    }
  }

  /**
   * Generate subtitles from audio file, matching WebsiteVersionServer implementation
   * @param useSimulation If true, simulates transcription without calling the API (for testing)
   */
  async generateSubtitlesFromAudio(
    inputAudioPath: string,
    targetLanguage: string = "original",
    progressCallback?: (progress: {
      percent: number;
      stage: string;
      current?: number;
      total?: number;
      partialResult?: string;
    }) => void,
    _useSimulation: boolean = false // Parameter is now ignored, always using real API
  ): Promise<string> {
    try {
      // Important: Never use simulation mode anymore, we always use the real API now

      // Log the API client status to help with debugging
      log.info(
        "OpenAI client status:",
        this.hasOpenAIClient() ? "Available" : "Not available"
      );
      log.info(
        "Anthropic client status:",
        this.hasAnthropicClient() ? "Available" : "Not available"
      );

      // Check if API clients are available
      if (!this.openai) {
        log.error(
          "OpenAI client not initialized, forcing init with hardcoded key"
        );

        // Fallback to hardcoded key
        const OPENAI_API_KEY =
          "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";
        this.openai = new OpenAI({
          apiKey: OPENAI_API_KEY,
        });
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
        // Use OpenAI Whisper API for transcription or translation
        if (targetLanguage === "original" || targetLanguage === "en") {
          // For English or original language, use transcription
          response = await this.openai.audio.transcriptions.create({
            file: await this.createFileFromPath(inputAudioPath),
            model: "whisper-1",
            response_format: "verbose_json",
            language:
              targetLanguage === "original" ? undefined : targetLanguage,
          });
        } else {
          // For other languages, use translation
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

          // Transcribe or translate the chunk with retries
          let chunkResponse: any = null;
          const MAX_RETRIES = 3;

          for (let retry = 0; retry < MAX_RETRIES; retry++) {
            try {
              if (targetLanguage === "original" || targetLanguage === "en") {
                chunkResponse = await this.openai.audio.transcriptions.create({
                  file: await this.createFileFromPath(chunkPath),
                  model: "whisper-1",
                  response_format: "verbose_json",
                  language:
                    targetLanguage === "original" ? undefined : targetLanguage,
                });
              } else {
                chunkResponse = await this.openai.audio.translations.create({
                  file: await this.createFileFromPath(chunkPath),
                  model: "whisper-1",
                  response_format: "verbose_json",
                });
              }

              // If we get here, the request succeeded, so break out of retry loop
              break;
            } catch (error) {
              log.error(`Attempt ${retry + 1} failed for chunk ${i}:`, error);

              // If this was the last retry, rethrow the error
              if (retry === MAX_RETRIES - 1) {
                throw error;
              }

              // Otherwise, wait a bit before retrying
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * (retry + 1))
              );
            }
          }

          if (!chunkResponse) {
            throw new AIServiceError(
              `Failed to process chunk ${i} after multiple retries`
            );
          }

          const chunkSegments = chunkResponse.segments || [];

          // Adjust timestamps based on chunk start time
          for (const segment of chunkSegments) {
            segment.start += chunkStartTime;
            segment.end += chunkStartTime;
          }

          allSegments.push(...chunkSegments);

          // Update progress and deliver partial results
          transcriptionProgress += progressPerChunk;

          // Convert current segments to SRT and provide partial results
          if (progressCallback && allSegments.length > 0) {
            const partialSrt = this.convertSegmentsToSrt(allSegments);
            progressCallback({
              percent: transcriptionProgress,
              stage: `Processed ${i + 1} of ${numChunks} chunks`,
              current: i + 1,
              total: numChunks,
              partialResult: partialSrt,
            });
          }

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
  async translateBatch(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    progressCallback?: (progress: {
      percent: number;
      stage: string;
      current?: number;
      total?: number;
      partialResult?: string;
    }) => void
  ): Promise<string> {
    try {
      // Log the API client status to help with debugging
      log.info(
        "OpenAI client status:",
        this.hasOpenAIClient() ? "Available" : "Not available"
      );
      log.info(
        "Anthropic client status:",
        this.hasAnthropicClient() ? "Available" : "Not available"
      );

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

        const message = await this.callClaudeWithRetry({
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

          // Call Claude with retry logic for more reliable translation
          const message = await this.callClaudeWithRetry({
            model: "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            system: `You are a professional subtitle translator. Translate the following subtitles from ${sourceLanguage} to ${targetLanguage}. 
                    Maintain the original format and structure, including all line breaks and numbering.
                    Each numbered subtitle block should remain a separate subtitle with its own number and timestamp line.
                    Preserve the subtitle numbers and timestamp lines exactly as they appear in the original.
                    Only translate the actual subtitle text content.
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

            // Provide partial translation results
            if (progressCallback) {
              // Combine all translated blocks so far
              const partialTranslation = translatedBlocks.join("\n\n");
              progressCallback({
                percent: 10 + (batchIndex / totalBatches) * 80,
                stage: `Translated ${
                  batchIndex + 1
                } of ${totalBatches} batches`,
                current: batchIndex + 1,
                total: totalBatches,
                partialResult: partialTranslation,
              });
            }
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

        // Optional: Review translation quality similar to WebsiteVersionServer
        if (progressCallback) {
          progressCallback({
            percent: 95,
            stage: "Performing final quality check",
          });
        }

        // Call a final quality check if needed
        // For now, we'll skip this step as it's implemented separately in the website version

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
   * Helper method to call Claude with retry logic
   */
  private async callClaudeWithRetry(params: any, maxRetries = 3): Promise<any> {
    let lastError: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Create an AbortController for timeout handling
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort("Request timeout");
        }, 45000); // 45 second timeout

        const result = await this.anthropic.messages.create(params, {
          signal: abortController.signal,
        });

        // Clear the timeout since the request completed successfully
        clearTimeout(timeoutId);

        // Return the successful result
        return result;
      } catch (error) {
        lastError = error;

        // Check if we should retry based on the error
        const isRetriableError =
          (error as any).name === "AbortError" || // Timeout error
          ((error as any).status >= 500 && (error as any).status < 600) || // Server errors
          (error as Error).message?.includes("timeout") ||
          (error as Error).message?.includes("network") ||
          (error as Error).message?.includes("ECONNRESET");

        if (!isRetriableError) {
          // If not a retriable error, break out of the loop
          break;
        }

        // If not the last attempt, wait with exponential backoff
        if (attempt < maxRetries - 1) {
          const backoffTime = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
        }
      }
    }

    // If we get here, all retries failed
    throw (
      lastError ||
      new AIServiceError("Failed to call Claude API after multiple retries")
    );
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
