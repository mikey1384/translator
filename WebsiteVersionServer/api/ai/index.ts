import {
  APPLIED_MODEL,
  ZERO_TWINKLE_ID,
  CIEL_TWINKLE_ID,
  O1_MINI,
  O1_PREVIEW,
  GPT_LATEST,
  GPT4,
  GPT4_MAX_OUTPUT_TOKENS,
  GPT4_MINI_MAX_OUTPUT_TOKENS,
  GPT4_MINI
} from '../../constants';
import socket from '../../constants/socketClient';
import { S3Client } from '@aws-sdk/client-s3';
const client = new S3Client({ region: process.env.AWS_REGION });
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import request from 'axios';
import { v1 as uuidv1 } from 'uuid';
import { bucketName } from '../../config';
import { poolQuery, uploadFromStream } from '..';
import { User } from '../../types';
import {
  formatUserJSON,
  formatMessages,
  getOrCreateThread,
  shuffleArray,
  fetchWebpageText,
  getPreviousMessages,
  insertNewEmptyAIMessage,
  createGPTCompletionWithRetry,
  generateGPTResponseInObj,
  getLatestFileThread,
  executeOpenAIRun,
  executeFileReaderRun,
  convertSegmentsToSrt
} from './utils';
import { getAssistant } from '../../assistants';
import { Stream } from 'openai/streaming';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'child_process';
import path from 'path';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: {
    'OpenAI-Beta': 'assistants=v2'
  }
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const openAIStreamCancelObj: Record<number, (() => void) | undefined> = {};

async function detectSilenceBoundaries(
  inputAudioPath: string
): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    const boundaries: number[] = [];
    const ffmpegProcess = spawn('ffmpeg', [
      '-i',
      inputAudioPath,
      '-af',
      'silencedetect=noise=-50dB:d=0.5',
      '-f',
      'null',
      '-'
    ]);

    let stderr = '';
    ffmpegProcess.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpegProcess.on('close', () => {
      // Look for lines like "silence_end: 5.123 | silence_duration: 0.50"
      const regex = /silence_end:\s*([\d.]+)/g;
      let match;
      while ((match = regex.exec(stderr)) !== null) {
        boundaries.push(parseFloat(match[1]));
      }
      resolve(boundaries);
    });

    ffmpegProcess.on('error', (err: Error) => {
      reject(err);
    });
  });
}

async function chunkAudioByDuration(
  inputAudioPath: string,
  maxChunkSize: number
): Promise<{ chunkPaths: string[]; chunkDuration: number }> {
  const fileSize = fs.statSync(inputAudioPath).size;
  const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
    ffmpeg(inputAudioPath).ffprobe(
      (err: Error | null, data: ffmpeg.FfprobeData) => {
        if (err) reject(err);
        else resolve(data);
      }
    );
  });

  const totalDuration = metadata.format.duration;
  if (!totalDuration) throw new Error('Could not determine audio duration');

  // Calculate bytes per second (bitrate) and the target chunk duration (in seconds)
  const bitrate = fileSize / totalDuration; // bytes per second
  const targetChunkDuration = maxChunkSize / bitrate; // in seconds

  // Get candidate silence boundaries from the audio
  const silenceBoundaries = await detectSilenceBoundaries(inputAudioPath);
  // Use a tolerance (in seconds) to decide whether a silence is "close enough"
  const tolerance = 2; // seconds

  const chunkPaths: string[] = [];
  let startTime = 0;
  let chunkIndex = 0;

  while (startTime < totalDuration) {
    let idealEnd = startTime + targetChunkDuration;
    if (idealEnd > totalDuration) {
      idealEnd = totalDuration;
    }
    // Look for a silence boundary near the ideal end (after the ideal point, within tolerance)
    let chosenEnd = idealEnd;
    for (const boundary of silenceBoundaries) {
      if (boundary >= idealEnd && boundary <= idealEnd + tolerance) {
        chosenEnd = boundary;
        break;
      }
    }
    // In the unlikely event the candidate chunk is too short, fall back to the ideal duration.
    if (chosenEnd - startTime < 1) {
      chosenEnd = idealEnd;
    }
    const chunkDuration = chosenEnd - startTime;
    const chunkPath = path.join(
      'uploads',
      `chunk_${Date.now()}_${chunkIndex}.mp3`
    );
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputAudioPath)
        .setStartTime(startTime)
        .setDuration(chunkDuration)
        .output(chunkPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
    chunkPaths.push(chunkPath);
    startTime = chosenEnd;
    chunkIndex++;
  }

  return { chunkPaths, chunkDuration: targetChunkDuration };
}

export async function generateSubtitlesFromAudio({
  inputAudioPath,
  targetLanguage = 'original',
  userId,
  progressRange
}: {
  inputAudioPath: string;
  targetLanguage?: string;
  userId?: number;
  progressRange?: { start: number; end: number };
}): Promise<string> {
  let response: any;

  const progressStart = progressRange?.start || 0;
  const progressEnd = progressRange?.end || 100;
  const progressSpan = progressEnd - progressStart;

  const scaleProgress = (originalProgress: number) => {
    return progressStart + (originalProgress / 100) * progressSpan;
  };

  const MAX_CHUNK_SIZE = 20 * 1024 * 1024; // 20MB limit
  const fileSize = fs.statSync(inputAudioPath).size;
  let allSegments: any[] = [];

  try {
    if (userId) {
      socket.emit('subtitle_translation_progress', {
        userId,
        progress: scaleProgress(0),
        stage: 'transcription'
      });
    }

    if (fileSize <= MAX_CHUNK_SIZE) {
      if (userId) {
        socket.emit('subtitle_translation_progress', {
          userId,
          progress: scaleProgress(10),
          stage: 'Transcribing audio'
        });
      }

      if (targetLanguage === 'original') {
        response = await openai.audio.transcriptions.create({
          file: fs.createReadStream(inputAudioPath) as any,
          model: 'whisper-1',
          response_format: 'verbose_json'
        });
      } else {
        response = await openai.audio.translations.create({
          file: fs.createReadStream(inputAudioPath) as any,
          model: 'whisper-1',
          response_format: 'verbose_json'
        });
      }
      allSegments = response.segments ?? [];
    } else {
      const { chunkPaths, chunkDuration } = await chunkAudioByDuration(
        inputAudioPath,
        MAX_CHUNK_SIZE
      );

      let transcriptionProgress = 10;
      const progressPerChunk = 75 / chunkPaths.length;

      for (let i = 0; i < chunkPaths.length; i++) {
        const chunkPath = chunkPaths[i];
        const chunkStartTime = i * chunkDuration;

        let chunkResponse: any;
        if (targetLanguage === 'original') {
          chunkResponse = await openai.audio.transcriptions.create({
            file: fs.createReadStream(chunkPath) as any,
            model: 'whisper-1',
            response_format: 'verbose_json'
          });
        } else {
          chunkResponse = await openai.audio.translations.create({
            file: fs.createReadStream(chunkPath) as any,
            model: 'whisper-1',
            response_format: 'verbose_json'
          });
        }

        const chunkSegments = chunkResponse.segments ?? [];
        for (const segment of chunkSegments) {
          segment.start += chunkStartTime;
          segment.end += chunkStartTime;
        }
        allSegments.push(...chunkSegments);

        transcriptionProgress += progressPerChunk;
        if (userId) {
          socket.emit('subtitle_translation_progress', {
            userId,
            progress: scaleProgress(transcriptionProgress),
            stage: `Transcribing chunk ${i + 1} of ${chunkPaths.length}`
          });
        }
      }

      for (const chunkPath of chunkPaths) {
        try {
          await fs.promises.unlink(chunkPath);
        } catch (err) {
          console.error(`Failed to delete ${chunkPath}:`, err);
        }
      }
      allSegments.sort((a, b) => a.start - b.start);
    }

    if (userId) {
      socket.emit('subtitle_translation_progress', {
        userId,
        progress: scaleProgress(85),
        stage: 'transcription complete'
      });
    }

    response = { segments: allSegments };

    if (targetLanguage !== 'original') {
      const segments = response.segments ?? [];

      if (userId) {
        socket.emit('subtitle_translation_progress', {
          userId,
          progress: scaleProgress(90),
          stage: 'translation',
          total: segments.length
        });
      }

      let languagePrompt = 'the target language';
      if (targetLanguage === 'korean') languagePrompt = 'Korean';
      else if (targetLanguage === 'japanese') languagePrompt = 'Japanese';
      else if (targetLanguage === 'chinese') languagePrompt = 'Chinese';
      else if (targetLanguage === 'spanish') languagePrompt = 'Spanish';
      else if (targetLanguage === 'french') languagePrompt = 'French';
      else if (targetLanguage === 'german') languagePrompt = 'German';

      const translatedSegments: any[] = [];
      const BATCH_SIZE = 10;

      for (
        let batchStart = 0;
        batchStart < segments.length;
        batchStart += BATCH_SIZE
      ) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, segments.length);
        const currentBatch = segments.slice(batchStart, batchEnd);

        const batchContextPrompt: string[] = [];
        currentBatch.forEach((batchSegment: any, batchIdx: number) => {
          const absoluteIdx = batchStart + batchIdx;
          batchContextPrompt.push(
            `Line ${absoluteIdx + 1}: ${batchSegment.text}`
          );
        });

        const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles to natural, fluent ${languagePrompt}.

Here are the subtitles to translate:
${batchContextPrompt.join('\n')}

Translate ALL lines to ${languagePrompt}.
Respond with ONLY the translations in this format:
Line 1: <translation>
Line 2: <translation>
...and so on for each line

Ensure you preserve the exact line numbers as given in the original text. Translations should be natural and fluent in ${languagePrompt}. IMPORTANT: Never modify the original text in any way.

For languages with different politeness levels (Korean, Japanese, Thai, etc.), use ONLY polite form for narration or formal speech (like documentaries, educational content, news).`;

        try {
          const MAX_RETRIES = 3;
          const TIMEOUT_MS = 120000;

          let retryCount = 0;
          let lastError: any = null;
          let success = false;

          while (retryCount < MAX_RETRIES && !success) {
            try {
              const abortController = new AbortController();
              const timeoutId = setTimeout(() => {
                abortController.abort('Request timeout');
              }, TIMEOUT_MS);

              const completion = await anthropic.messages.create(
                {
                  model: 'claude-3-7-sonnet-20250219',
                  max_tokens: 4000,
                  system: `You are a professional subtitle translator specializing in natural, fluent translations. For languages with different politeness levels (Korean, Japanese, Thai, etc.), always use the polite form by default unless the context clearly indicates informality is required. Maintain the meaning, tone, and cultural nuances of the original while ensuring your translations sound natural to native speakers.`,
                  messages: [{ role: 'user', content: combinedPrompt }]
                },
                { signal: abortController.signal }
              );

              clearTimeout(timeoutId);

              const translationText =
                completion.content[0]?.type === 'text'
                  ? completion.content[0].text.trim()
                  : '';

              const translationLines = translationText.split('\n');
              const lineRegex = /^Line (\d+):\s*(.+)$/;

              for (let i = 0; i < currentBatch.length; i++) {
                const segmentIndex = batchStart + i;
                const segment = currentBatch[i];
                const originalTextToPreserve = segment.text;

                let translatedText = originalTextToPreserve;
                for (const line of translationLines) {
                  const match = line.match(lineRegex);
                  if (match && parseInt(match[1]) === segmentIndex + 1) {
                    translatedText = match[2].trim();
                    break;
                  }
                }

                translatedSegments.push({
                  ...segment,
                  text: `${originalTextToPreserve}###TRANSLATION_MARKER###${translatedText}`,
                  originalText: originalTextToPreserve,
                  translatedText
                });
              }
              success = true;
            } catch (err) {
              lastError = err;
              const isRetriableError =
                (err as any).name === 'AbortError' ||
                ((err as any).status >= 500 && (err as any).status < 600) ||
                (err as Error).message?.includes('timeout') ||
                (err as Error).message?.includes('network') ||
                (err as Error).message?.includes('ECONNRESET');

              if (!isRetriableError) {
                break;
              }
              retryCount++;
              if (retryCount < MAX_RETRIES) {
                const backoffTime = Math.min(
                  1000 * Math.pow(2, retryCount),
                  8000
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, backoffTime)
                );
              }
            }
          }

          if (!success) {
            console.error(
              `All translation retries failed for batch starting at segment ${batchStart}:`,
              lastError
            );
            for (let i = 0; i < currentBatch.length; i++) {
              const segment = currentBatch[i];
              if (!translatedSegments.some((s) => s.start === segment.start)) {
                translatedSegments.push({
                  ...segment,
                  text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
                  originalText: segment.text,
                  translatedText: segment.text
                });
              }
            }
          }
        } catch (error) {
          console.error(
            `Translation error for batch starting at segment ${batchStart}:`,
            error
          );
          for (let i = 0; i < currentBatch.length; i++) {
            const segment = currentBatch[i];
            if (!translatedSegments.some((s) => s.start === segment.start)) {
              translatedSegments.push({
                ...segment,
                text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
                originalText: segment.text,
                translatedText: segment.text
              });
            }
          }
        }

        if (userId) {
          const progressPercentage = Math.floor(
            scaleProgress(90 + (batchEnd / segments.length) * 9)
          );
          socket.emit('subtitle_translation_progress', {
            userId,
            progress: progressPercentage,
            stage: 'translation',
            current: batchEnd,
            total: segments.length
          });
        }
      }

      response.segments = translatedSegments;
    }

    if (userId) {
      socket.emit('subtitle_translation_progress', {
        userId,
        progress: scaleProgress(100),
        stage: 'complete'
      });
    }

    const segments = response.segments ?? [];
    const srt = convertSegmentsToSrt(segments);
    return srt;
  } catch (error) {
    if (userId) {
      socket.emit('subtitle_translation_progress', {
        userId,
        progress: scaleProgress(0),
        stage: 'error',
        error: error instanceof Error ? error.message : 'Transcription failed'
      });
    }
    console.error('Error in transcription:', error);
    throw error;
  }
}

export function generateThreadKey({
  channelId,
  topicId
}: {
  channelId: number;
  topicId?: number | null;
}): string {
  return `chat_${channelId}${topicId ? `_topic_${topicId}` : ''}`;
}

export async function fetchTTSChunks(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'echo'
) {
  const CHUNK_SIZE = 250;
  const TIMEOUT_MS = 20000;

  const chunks = chunkText(text);
  const promises = chunks.map((chunk) => fetchTTS(chunk, voice || 'echo'));
  return Promise.all(promises);

  function chunkText(text: string) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + CHUNK_SIZE, text.length);

      const lastPunctuation = findLastPunctuation(text, start, end);

      if (lastPunctuation === -1 && end < text.length) {
        end = start;
        while (end < text.length && !isPunctuation(text[end])) {
          end++;
        }
        if (end < text.length) {
          end++;
        }
      } else if (lastPunctuation > start) {
        end = lastPunctuation + 1;
      }

      if (end > start) {
        chunks.push(text.substring(start, end).trim());
      }
      start = end;
    }
    return chunks;
  }

  function findLastPunctuation(text: string, start: number, end: number) {
    for (let i = end - 1; i >= start; i--) {
      if (isPunctuation(text[i])) {
        return i;
      }
    }
    return -1;
  }

  function isPunctuation(char: string) {
    return ['.', '!', '?', '\n'].includes(char);
  }

  async function fetchTTS(
    text: string,
    voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  ) {
    const response: any = await Promise.race([
      openai.audio.speech.create({
        model: 'tts-1',
        voice,
        input: text
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), TIMEOUT_MS)
      )
    ]);

    return Buffer.from(await response.arrayBuffer());
  }
}

async function checkIfMessageRelatedToFile(messages: any[]) {
  try {
    const { formattedMessages } = await formatMessages({
      messages,
      model: GPT4
    });

    const prompt = `
      Conversation: ${JSON.stringify(formattedMessages)}

      You are a classification model. 

      Your goal is to decide if answering the last user message requires referencing or accessing the content of a previously shared file.

      Follow these rules for your classification:
      1. Output "true" (without quotes) if, and only if:
         - The user's last message specifically requires data from the file's content (e.g., asking details, analysis, or anything requiring looking inside the file).
      2. Otherwise, output "false".

      Examples where the output is "false":
       - "Thanks for the file!"
       - "I'll read it later"
       - "What file type is it?"
       - "When did you send the file?"

      Examples where the output is "true":
       - "What is mentioned in the second paragraph about topic X?"
       - "Could you clarify what was stated in Section 2 of the report?"
       - "Could you summarize the key findings in the PDF?"
    `;

    const result = await generateGPTResponseInObj({
      model: GPT4_MINI,
      prompt,
      expectedStructure: {
        output: false,
        lastMessage: '',
        reason: '',
        referredFile: ''
      }
    });
    return result.output;
  } catch (error) {
    console.error('Error checking file relation:', error);
    return false;
  }
}

async function checkIfMessageNeedsHistory(messages: any[]) {
  try {
    const prompt = `
      You are a classification model. 
      You will receive a conversation (array of messages). 
      Your task: Decide if the user's last message requires referring to older conversation context NOT included in the provided messages.
      
      Messages: ${JSON.stringify(messages)}

      Follow these rules for your classification:
      - Output "true" (without quotes) ONLY if:
        1. The last user message references or requires context from an older conversation 
           that is NOT contained in the provided messages.
        2. The user is asking about something previously discussed, but not shown in these messages.
      - Output "false" for anything else, including:
        1. Standalone questions or statements that can be answered without older context.
        2. Generic greetings or responses.
        3. New topics or conversation starters.
        4. Simple or general knowledge questions.
        5. Anything that can be fully answered by the provided messages.
        6. References to files or documents (those are handled elsewhere).
    `;

    const result = await generateGPTResponseInObj({
      model: GPT4_MINI,
      prompt,
      expectedStructure: {
        output: false
      }
    });

    return result.output;
  } catch (error) {
    console.error('Error checking history relation:', error);
    return false;
  }
}

export async function generateAIResponseForChat({
  channelId,
  topicId,
  AIUsername,
  user,
  AIThinkingLevel = 0
}: {
  channelId: number;
  topicId?: number | null;
  AIUsername: 'Ciel' | 'Zero';
  user: User;
  AIThinkingLevel?: number;
}) {
  try {
    const aiAgent = getAssistant(AIUsername);
    let customSysPrompt = '';
    let targetSubject = null;
    if (topicId) {
      const topicRow = await poolQuery(
        `SELECT * 
        FROM content_chat_subjects 
        WHERE id = ? AND isDeleted != 1`,
        [topicId],
        true
      );
      if (topicRow.length) {
        targetSubject = topicRow[0];
      }
      if (topicRow.length) {
        customSysPrompt = targetSubject.settings?.customInstructions || '';
      }
    }

    const sysPrompt = `${aiAgent.systemPrompt}${customSysPrompt ? `\n${customSysPrompt}` : ''}`;

    const AIUserId = AIUsername === 'Ciel' ? CIEL_TWINKLE_ID : ZERO_TWINKLE_ID;
    let model = APPLIED_MODEL;
    if (AIThinkingLevel === 1) {
      model = O1_MINI;
    } else if (AIThinkingLevel === 2) {
      model = O1_PREVIEW;
    }
    const userJSON = formatUserJSON(user);

    const { AIsMessage, AIMessageId } = await insertNewEmptyAIMessage({
      channelId,
      topicId,
      AIUserId
    });
    socket.emit('new_ai_message', {
      message: {
        ...AIsMessage,
        targetSubject,
        username: AIUsername,
        id: AIMessageId
      },
      channelId
    });
    const { prevMessages, isReply } = await getPreviousMessages({
      AIMessageId,
      channelId,
      topicId
    });

    let fileDescription = '';

    const isFileRelated = await checkIfMessageRelatedToFile(prevMessages);
    let threadId = null;
    if (isFileRelated && !prevMessages[prevMessages.length - 1].filePath) {
      socket.emit('update_ai_thinking_status', {
        channelId,
        status: 'reading_file',
        messageId: AIMessageId
      });
      threadId = await getLatestFileThread({ channelId, topicId });
      if (threadId) {
        const lastMessage = prevMessages[prevMessages.length - 1];
        if (lastMessage) {
          try {
            const fileUrl = `https://d3jvoamd2k4p0s.cloudfront.net/attachments/feed/${lastMessage.filePath}/${lastMessage.fileName}`;
            const { result, isPreviousThreadExpired } =
              await executeFileReaderRun({
                threadId,
                fileUrl,
                content: lastMessage.content
              });
            if (isPreviousThreadExpired) {
              await poolQuery('DELETE FROM ai_chat_files WHERE threadId = ?', [
                threadId
              ]);
            }
            fileDescription = result;
          } catch (error) {
            console.error('Error executing file reader run:', error);
            await poolQuery('DELETE FROM ai_chat_files WHERE threadId = ?', [
              threadId
            ]);
            fileDescription = '';
          }
        }
      }
    }

    const appliedSysPrompt = `
      ${sysPrompt}

      USER INFORMATION:
      - You are conversing with user: ${user.username}
      - User profile details: ${userJSON}
      
      CURRENT DATE:
      ${new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}

      FILE CAPABILITIES:
      - You can read and analyze files
      - When you see [ATTACHED FILE] in messages, remember THESE ARE YOUR OWN generated descriptions, not the user's, even if it's included in the message sent by the user

      ${
        fileDescription
          ? `
      [ATTACHED FILE]: ${fileDescription}
      `
          : ''
      }
    `;

    const threadKey = generateThreadKey({ channelId, topicId });

    await processGPTRequest({
      AIMessageId,
      AIUserId,
      channelId,
      topicId,
      threadKey,
      isRequiresThread: true,
      isReply,
      messages: prevMessages,
      instructions: appliedSysPrompt,
      model,
      onNewData: (data: any) => {
        socket.emit('edit_chat_message', {
          channelId,
          editedMessage: data,
          messageId: AIMessageId
        });
      },
      onDone: async (data: any) => {
        socket.emit('finish_ai_message', channelId);
        await poolQuery(`UPDATE msg_chats SET content = ? WHERE id = ?`, [
          data,
          AIMessageId
        ]);
        if (prevMessages[prevMessages.length - 1]) {
          await poolQuery(`INSERT INTO ai_chatbot_prompts SET ?`, {
            chatbotId: AIUserId,
            userId: user.id,
            contentId: prevMessages[prevMessages.length - 1].id,
            contentType: 'chat',
            prompt: prevMessages[prevMessages.length - 1].content,
            response: data,
            topicId: topicId || null,
            timeStamp: Math.floor(Date.now() / 1000)
          });
        }
      },
      stream: AIThinkingLevel === 0,
      user,
      delayTimeout: 10000
    });
  } catch (err) {
    console.error(err);
    socket.emit('finish_ai_message', channelId);
  }
}

export async function generateAndUploadImage({
  story,
  style,
  userId
}: {
  story: string;
  style?: string;
  userId: number;
}) {
  try {
    let artStylePrompt = '';
    let finalArtStyle = '';

    if (style) {
      const styleValidationPrompt = `
        Given the following user-entered art style, determine if it is a valid art style prompt or gibberish.
        If it is a valid art style, provide the original text if it's not too long or grammatically incorrect. If it is too long or grammatically incorrect, provide a concise and corrected version of the style. If it is not a valid art style or is gibberish, respond with { isValidStyle: false }.
        
        User-entered art style: ${style}
        
        Response format:
        {
          isValidStyle: true/false,
          artStyle: "original or concise version of the valid art style" (only if isValidStyle is true)
        }
      `;

      const styleValidationResponse = await generateGPTResponseInObj({
        prompt: styleValidationPrompt,
        expectedStructure: {
          isValidStyle: false,
          artStyle: ''
        }
      });

      if (styleValidationResponse.isValidStyle) {
        artStylePrompt = `Please use the following art style: ${styleValidationResponse.artStyle}.`;
        finalArtStyle = styleValidationResponse.artStyle;
      }
    }

    const gptPrompt = `
      Generate a detailed prompt for DALL-E 3 to create an image that illustrates the story.
      The prompt should include relevant visual elements and composition.
      
      Story: ${story}
      ${artStylePrompt}
      
      Prompt for DALL-E 3 (maximum 1000 characters):
    `;

    const dallePrompt = await generateGPTResponseInObj({
      prompt: gptPrompt,
      expectedStructure: { prompt: '' }
    });

    const response: any = await Promise.race([
      openai.images.generate({
        model: 'dall-e-3',
        prompt: `${dallePrompt.prompt}${artStylePrompt}`,
        n: 1,
        size: '1024x1024',
        user: `${process.env.NODE_ENV}-user${userId}`
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('OpenAI request timed out')), 50000);
      })
    ]);

    const imageUrl = response.data[0].url;

    const { data: fetchedImageData } = await request({
      method: 'get',
      url: imageUrl,
      responseType: 'arraybuffer'
    });

    const path = `${uuidv1()}.png`;

    await uploadFromStream({
      client,
      path,
      folderName: 'ai-story',
      bucketName: bucketName as string,
      data: fetchedImageData
    });

    return {
      imageUrl,
      dallePrompt: dallePrompt.prompt,
      path,
      artStyle: finalArtStyle || null
    };
  } catch (error) {
    console.error('Error generating or uploading image:', error);
    throw error;
  }
}

export async function generateMCQuestions({
  content,
  questionPrompt,
  numQuestions,
  numChoices = 4,
  temperature,
  isShuffled
}: {
  content: string;
  questionPrompt: string;
  numQuestions: number;
  numChoices?: number;
  retryCount?: number;
  temperature?: number;
  isShuffled?: boolean;
}): Promise<{
  questions: {
    [x: string]: any;
    id: number;
    question: string;
    choices: string[];
    answerIndex: number;
  }[];
}> {
  const prompt = `A question set according to this specification ((${questionPrompt})) containing ${numQuestions} ${
    numQuestions === 1
      ? 'multiple choice question'
      : 'multiple choice questions'
  } with ${numChoices} choices each, with 1 correct choice and ${
    numChoices - 1
  } wrong choices based on the following content: ${content}. Do not add numbers or letters to the choices, as this will be handled algorithmically.`;

  try {
    const expectedStructure = {
      questions: [
        {
          id: 1,
          question: '',
          choices: ['', '', '', ''],
          answerIndex: 'number for the index of the correct choice'
        }
      ]
    };
    if (numQuestions > 1) {
      expectedStructure.questions.push({
        id: 2,
        question: '',
        choices: ['', '', '', ''],
        answerIndex: 'number for the index of the correct choice'
      });
    }
    const questionObj = await generateGPTResponseInObj({
      prompt,
      expectedStructure,
      temperature
    });
    if (isShuffled) {
      for (const question of questionObj.questions) {
        const correctAnswer = question.choices[question.answerIndex];
        shuffleArray(question.choices);
        question.answerIndex = question.choices.findIndex(
          (choice: string) => choice === correctAnswer
        );
      }
    }
    return questionObj;
  } catch (error: any) {
    throw new Error(`Error generating questions: ${error.message}`);
  }
}

export async function processGPTRequest({
  AIUserId,
  AIMessageId,
  channelId,
  topicId,
  isReply,
  threadKey,
  messages = [],
  model = APPLIED_MODEL,
  instructions,
  onDone,
  onNewData,
  stream = true,
  user,
  isRequiresThread = false,
  temperature,
  topP,
  delayTimeout = 60000
}: {
  AIUserId?: number;
  AIMessageId?: number;
  channelId?: number;
  topicId?: number | null;
  isReply?: boolean;
  threadKey?: string;
  messages?: any[];
  model?: string;
  instructions?: string;
  onDone: (data: string) => void;
  onNewData: (data: string) => void;
  delayTimeout?: number;
  stream?: boolean;
  user?: User;
  isRequiresThread?: boolean;
  temperature?: number;
  topP?: number;
}) {
  const abortController = new AbortController();
  let currentThreadId: string | null = null;

  if (AIMessageId) {
    openAIStreamCancelObj[AIMessageId] = () => {
      try {
        abortController.abort();
      } catch (error) {
        console.error('Error when aborting the stream:', error);
      }
    };
  }

  try {
    if (isRequiresThread) {
      currentThreadId = await getOrCreateThread({
        threadKey,
        isReply,
        messages,
        user
      });
    }

    await processStreamRequest({
      AIUserId,
      AIMessageId,
      messages,
      channelId,
      currentThreadId,
      topicId,
      model,
      instructions,
      onDone,
      onNewData,
      temperature,
      topP,
      user,
      delayTimeout,
      stream,
      abortController
    });
  } catch (error: any) {
    console.error('Error occurred while processing GPT request:', error);

    if (currentThreadId && isRequiresThread) {
      await poolQuery(`DELETE FROM ai_threads WHERE threadId = ?`, [
        currentThreadId
      ]);
    }
    await onDone(error?.message || 'An error occurred');
  } finally {
    if (AIMessageId) {
      delete openAIStreamCancelObj[AIMessageId];
    }
  }
}

async function processStreamRequest({
  AIUserId,
  AIMessageId,
  messages,
  channelId,
  topicId,
  model = APPLIED_MODEL,
  instructions,
  onDone,
  onNewData,
  currentThreadId,
  temperature = 1,
  topP = 1,
  user,
  delayTimeout = 60000,
  stream = true,
  abortController
}: {
  AIUserId?: number;
  AIMessageId?: number;
  messages: any[];
  channelId?: number;
  currentThreadId?: string | null;
  topicId?: number | null;
  model: string;
  instructions?: string;
  onDone: (data: string) => void;
  onNewData: (data: string) => void;
  temperature?: number;
  topP?: number;
  user?: User;
  delayTimeout?: number;
  stream?: boolean;
  abortController?: AbortController;
}) {
  let accumulatedText = '';
  let timer: any;

  try {
    const { formattedMessages, isFileMessage } = await formatMessages({
      AIMessageId,
      channelId,
      topicId,
      AIUserId,
      messages,
      user,
      model
    });
    let memory = '';
    if (AIUserId && AIMessageId) {
      const needsHistory = isFileMessage
        ? false
        : await checkIfMessageNeedsHistory(formattedMessages);
      if (needsHistory && currentThreadId) {
        socket.emit('update_ai_thinking_status', {
          channelId,
          status: 'retrieving_memory',
          messageId: AIMessageId
        });
        const run = await openai.beta.threads.runs.create(currentThreadId, {
          assistant_id: getAssistant('MemoryRetriever').assistantId as string
        });

        try {
          memory = await executeOpenAIRun(run);
        } catch (error) {
          console.error('Error getting memory:', error);
          memory = '';
        }
      }
    }

    const requestMessages = [
      ...(instructions
        ? [
            {
              role: model === APPLIED_MODEL ? 'system' : 'user',
              content: `${instructions}${memory ? `\n\nHere are additional data retrieved from your long term memory: [[${memory}]]` : ''}`
            }
          ]
        : []),
      ...formattedMessages
    ];

    const requestOptions: any = {
      model,
      messages: requestMessages,
      stream
    };

    if (model !== O1_MINI && model !== O1_PREVIEW) {
      const maxOutputTokens =
        model === GPT4 || model === GPT_LATEST
          ? GPT4_MAX_OUTPUT_TOKENS
          : GPT4_MINI_MAX_OUTPUT_TOKENS;

      requestOptions.temperature = temperature;
      requestOptions.top_p = topP;
      requestOptions.max_tokens = maxOutputTokens;
    }

    const response = await openai.chat.completions.create(
      requestOptions,
      abortController ? { signal: abortController.signal } : undefined
    );

    if (stream && response instanceof Stream) {
      for await (const chunk of response) {
        if (abortController?.signal.aborted) {
          break;
        }

        clearTimeout(timer);
        timer = setTimeout(() => {
          throw new Error('Stream data delay timeout exceeded');
        }, delayTimeout);

        const content = chunk.choices[0]?.delta?.content || '';
        accumulatedText += content;
        onNewData(accumulatedText);
      }
    } else {
      if ('choices' in response) {
        accumulatedText = response.choices[0]?.message?.content || '';
        onNewData(accumulatedText);
      } else {
        throw new Error(
          'Expected a non-streaming response, but received an invalid one'
        );
      }
    }

    clearTimeout(timer);
    await onDone(accumulatedText);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('Request was aborted');
    } else {
      console.error('Error occurred while fetching chat completion:', error);
    }
    await onDone(accumulatedText);
    throw error;
  }
}

export async function cancelOpenAIStream(AIMessageId: number) {
  const cancelObj = openAIStreamCancelObj[AIMessageId];
  if (cancelObj) {
    if (typeof cancelObj === 'function') {
      cancelObj();
    }
    delete openAIStreamCancelObj[AIMessageId];
  }
}

export async function summarizeWeblinkUsingGPT({
  url,
  onNewData,
  onDone,
  onError
}: {
  url: string;
  onNewData: (summary: string) => void;
  onDone: (summary: string) => void;
  onError: (error: Error) => void;
}) {
  if (!url) {
    return console.error('No URL provided');
  }
  try {
    const webpageText = await fetchWebpageText(url);
    await processGPTRequest({
      messages: [
        {
          role: 'system',
          content: `Summarize the following webpage using words even 10 year olds can understand, focusing on the most interesting article within the page. If there's no article, then describe what the page is about. If there are advanced words in the article, list them at the end with easy explanations and proper formatting.`
        },
        { role: 'user', content: webpageText }
      ],
      onNewData,
      onDone
    });
  } catch (error: any) {
    onError(error);
  }
}

export { createGPTCompletionWithRetry, generateGPTResponseInObj };
