import { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { Message, User } from "../../types";
import { isImageFile } from "../string";
import { load } from "cheerio";
import moment from "moment";
import request from "axios";
import socket from "../../constants/socketClient";
import { poolQuery } from "..";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  GPT4,
  GPT4_MINI,
  APPLIED_MODEL,
  GPT4_MINI_MAX_OUTPUT_TOKENS,
  GPT4_MAX_OUTPUT_TOKENS,
  O1_MINI,
  O1_PREVIEW,
} from "../../constants";
import OpenAI from "openai";
import { getAssistant } from "../../assistants";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: {
    "OpenAI-Beta": "assistants=v2",
  },
});

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
]);

const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpg",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const FILE_SEARCH_SUPPORTED_EXTENSIONS = new Set([
  "c",
  "cpp",
  "cs",
  "css",
  "doc",
  "docx",
  "go",
  "html",
  "java",
  "js",
  "json",
  "md",
  "pdf",
  "php",
  "pptx",
  "py",
  "rb",
  "sh",
  "tex",
  "ts",
  "txt",
]);

const CODE_INTERPRETER_SUPPORTED_EXTENSIONS = new Set([
  "c",
  "cpp",
  "cs",
  "csv",
  "css",
  "doc",
  "docx",
  "gif",
  "html",
  "java",
  "jpeg",
  "jpg",
  "js",
  "json",
  "md",
  "pdf",
  "php",
  "pkl",
  "png",
  "pptx",
  "py",
  "rb",
  "sh",
  "tar",
  "tex",
  "ts",
  "txt",
  "xlsx",
  "xml",
  "zip",
]);

export function formatUserJSON(user: User) {
  const sanitize = (str: string) => str.replace(/[^\w\s]/gi, "");
  const appliedUsername = user.username === "mikey" ? "Mikey" : user.username;
  return JSON.stringify({
    username: appliedUsername,
    realName: user.realName,
    email: user.email,
    bio: [
      sanitize(user.profileFirstRow || ""),
      sanitize(user.profileSecondRow || ""),
      sanitize(user.profileThirdRow || ""),
    ],
    greeting: sanitize(user.greeting || ""),
    twinkleXP: user.twinkleXP,
    joinDate: moment.unix(user.joinDate || 0).format("lll"),
    userType: user.userType,
    statusMsg: sanitize(user.statusMsg || ""),
    profileTheme: user.profileTheme,
    youtubeUrl: user.youtubeUrl,
    website: user.website,
  });
}

export async function formatMessages({
  AIMessageId,
  messages,
  user,
  AIUserId,
  model,
  channelId,
  topicId,
}: {
  AIMessageId?: number;
  messages: Message[];
  user?: User;
  AIUserId?: number;
  model: string;
  channelId?: number;
  topicId?: number | null;
}): Promise<{ formattedMessages: any[]; isFileMessage?: boolean }> {
  const isO1Model = ["o1-mini", "o1"].includes(model);
  const formattedMessages: any[] = [];

  const lastMessage = messages[messages.length - 1];
  const lastMessageIsAReply = !!lastMessage?.targetMessageId;
  const isLastMessageFromUser = lastMessage?.userId === user?.id;
  const hasFileAttachment = !!(lastMessage?.filePath && lastMessage?.fileName);
  const isFileMessage = isLastMessageFromUser && hasFileAttachment;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const contentArray: ChatCompletionContentPart[] = [];
    const isUser = message.userId === user?.id;
    const messageContent = message.content || ".";

    const urls = extractUrls(messageContent);
    let lastIndex = 0;

    const urlsToProcess = urls.slice(0, 2);

    for (const { url, index } of urlsToProcess) {
      const textBeforeUrl = messageContent.slice(lastIndex, index);
      if (textBeforeUrl) {
        contentArray.push({ type: "text", text: textBeforeUrl });
      }

      if (isUser) {
        await handleImageFile({
          contentArray,
          fileUrl: url,
          isO1Model,
          text: messageContent || url,
        });
      } else {
        contentArray.push({ type: "text", text: url });
      }

      lastIndex = index + url.length;
    }

    const remainingText = messageContent.slice(lastIndex);
    if (remainingText) {
      contentArray.push({ type: "text", text: remainingText });
    }

    let fileUrl = "";
    if (message.filePath && message.fileName && AIMessageId) {
      fileUrl = `https://d3jvoamd2k4p0s.cloudfront.net/attachments/chat/${message.filePath}/${message.fileName}`;

      if (
        (i === messages.length - 1 ||
          (lastMessageIsAReply && i === messages.length - 2)) &&
        channelId
      ) {
        try {
          const { description, fileId, threadId, isNew, fileRowInsertId } =
            await getOrCreateFileThread({
              filePath: message.filePath,
              fileName: message.fileName,
              channelId,
              topicId,
              messageId: AIMessageId,
              prompt:
                lastMessageIsAReply && i === messages.length - 2
                  ? lastMessage?.content || ""
                  : messageContent,
            });
          if (isNew) {
            const [{ actualFileName = "" }] = await poolQuery(
              `SELECT actualFileName FROM content_files WHERE filePath = ?`,
              [message.filePath]
            );
            socket.emit("update_last_used_file", {
              channelId,
              topicId,
              file: {
                id: fileRowInsertId,
                description,
                filePath: message.filePath,
                fileName: message.fileName,
                fileId,
                threadId,
                actualFileName,
                messageId: message.id,
                messageContent,
                timeStamp: message.timeStamp,
              },
            });
          }
          if (description) {
            contentArray.push({
              type: "text",
              text: `[FILE SUMMARY]: ${description}\n\nPrompt: ${messageContent}`,
            });
          } else if (!isImageFile(fileUrl)) {
            contentArray.push({
              type: "text",
              text: `File URL: ${fileUrl}\nPrompt: ${messageContent}`,
            });
          } else {
            await handleImageFile({
              contentArray,
              fileUrl,
              isO1Model,
              text: message.content || fileUrl,
            });
          }
        } catch (error) {
          console.error("Error handling file thread:", error);
        }
      }
    }

    let finalContent: string | ChatCompletionContentPart[] = fileUrl
      ? `File URL: ${fileUrl}\nPrompt: ${messageContent}`
      : messageContent;
    if (contentArray.length > 0) {
      finalContent = contentArray;
    }

    formattedMessages.push({
      role: Number(message.userId) === AIUserId ? "assistant" : "user",
      content: finalContent,
    });
  }

  return {
    formattedMessages,
    isFileMessage,
  };

  function extractUrls(text: string): { url: string; index: number }[] {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls: { url: string; index: number }[] = [];
    let match: RegExpExecArray | null;

    while ((match = urlRegex.exec(text)) !== null) {
      urls.push({ url: match[0].replace(/\)$/, ""), index: match.index });
    }

    return urls;
  }

  async function handleImageFile({
    contentArray,
    fileUrl,
    isO1Model,
    text,
  }: {
    contentArray: ChatCompletionContentPart[];
    fileUrl: string;
    isO1Model: boolean;
    text?: string;
  }): Promise<void> {
    if (isO1Model) {
      try {
        const imageDescription = await getImageDescription(fileUrl);
        contentArray.push({ type: "text", text: imageDescription });
      } catch (error) {
        console.error(error);
        if (text) {
          contentArray.push({
            type: "text",
            text: `File URL: ${fileUrl}\nPrompt: ${text}`,
          });
        } else {
          contentArray.push({ type: "text", text: `File URL: ${fileUrl}` });
        }
      }
    } else {
      try {
        const validImageUrl = await validateImageFile(fileUrl);
        if (validImageUrl) {
          contentArray.push({
            type: "image_url",
            image_url: { url: validImageUrl },
          });
        } else {
          contentArray.push({
            type: "text",
            text: `Image URL: ${fileUrl}\nThis image is too large to process`,
          });
        }
      } catch (error) {
        console.error("Failed to get image description:", error);
        if (text) {
          contentArray.push({
            type: "text",
            text: `Image URL: ${fileUrl}\nPrompt: ${text}`,
          });
        } else {
          contentArray.push({ type: "text", text: `Image URL: ${fileUrl}` });
        }
      }
    }
  }

  async function validateImageFile(url: string) {
    const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
    const urlObj = new URL(url);
    let pathname = urlObj.pathname.toLowerCase();
    const extension = getFileExtension(pathname);

    let validatedUrl = url;

    if (!extension || !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      validatedUrl = `${urlObj.origin}${urlObj.pathname}.jpg`;
      pathname = `${urlObj.pathname}.jpg`;
      urlObj.pathname = pathname;
    }

    try {
      const response = await request.get(validatedUrl, {
        timeout: 5000,
        maxRedirects: 5,
        validateStatus: (status) => status === 200,
        responseType: "arraybuffer",
      });

      let contentType = response.headers["content-type"];
      const contentLength = response.data.length;

      if (contentLength > MAX_IMAGE_SIZE) {
        return "";
      }

      if (!contentType) {
        throw new Error("Content-Type header is missing");
      }

      contentType = contentType.split(";")[0].trim().toLowerCase();

      const buffer = Buffer.from(response.data);
      const isImage = isValidImageBuffer(buffer);

      if (!isImage) {
        throw new Error("Response is not a valid image");
      }

      if (extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
        return validatedUrl;
      }

      if (!SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
        console.warn(
          `Unexpected Content-Type: ${contentType} for URL: ${validatedUrl}`
        );
        if (urlObj.hostname === "d3jvoamd2k4p0s.cloudfront.net") {
          return validatedUrl;
        }
        throw new Error(`Unsupported Content-Type: ${contentType}`);
      }

      return validatedUrl;
    } catch (error) {
      if (extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
        console.warn(
          `Failed to validate image despite valid extension: ${validatedUrl}`,
          error
        );
      }
      throw new Error("Invalid image URL");
    }
  }

  function isValidImageBuffer(buffer: Buffer): boolean {
    const signatures = {
      jpeg: [0xff, 0xd8, 0xff],
      png: [0x89, 0x50, 0x4e, 0x47],
      gif87a: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
      gif89a: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
      webp: [0x52, 0x49, 0x46, 0x46],
    };

    for (const [format, signature] of Object.entries(signatures)) {
      if (signature.every((byte, i) => buffer[i] === byte)) {
        if (format === "webp") {
          const webpMarker = Buffer.from("WEBP");
          return webpMarker.every((byte, i) => buffer[i + 8] === byte);
        }
        return true;
      }
    }

    return false;
  }

  function getFileExtension(fileName: string) {
    const parts = fileName.split(".");
    return parts.length > 1 ? parts.pop()?.toLowerCase() || null : null;
  }
}

async function getOrCreateFileThread({
  filePath,
  fileName,
  channelId,
  topicId,
  messageId,
  prompt,
}: {
  filePath: string;
  fileName: string;
  channelId: number;
  topicId?: number | null;
  messageId: number;
  prompt: string;
}): Promise<{
  threadId: string | null;
  description: string | null;
  isNew: boolean;
  fileId?: number;
  fileRowInsertId: number;
}> {
  const fileUrl = `https://d3jvoamd2k4p0s.cloudfront.net/attachments/chat/${filePath}/${fileName}`;
  try {
    if (isImageFile(fileUrl)) {
      return {
        threadId: null,
        description: null,
        isNew: false,
        fileRowInsertId: 0,
      };
    }

    const [fileRow = null] = await poolQuery(
      `SELECT a.*, b.actualFileName, c.id AS messageId, c.timeStamp, c.content AS messageContent
      FROM ai_chat_files a
      LEFT JOIN content_files b ON a.filePath = b.filePath
      LEFT JOIN msg_chats c ON a.filePath = c.filePath
      WHERE a.filePath = ?`,
      [filePath]
    );

    if (fileRow) {
      await poolQuery(
        "UPDATE ai_chat_files SET lastUsed = NOW() WHERE id = ?",
        [fileRow.id]
      );
      socket.emit("update_last_used_file", {
        channelId,
        topicId,
        file: fileRow,
      });
    }

    if (!prompt && fileRow) {
      return {
        threadId: fileRow.threadId,
        description: fileRow.description,
        isNew: false,
        fileRowInsertId: 0,
      };
    }

    socket.emit("update_ai_thinking_status", {
      channelId,
      status: "reading_file",
      messageId,
    });

    const existingThreadId = fileRow?.threadId;
    let attachment;
    if (!existingThreadId) {
      attachment = await attachFile({ filePath: fileUrl });
      if (!attachment) {
        return {
          threadId: null,
          description: null,
          isNew: false,
          fileRowInsertId: 0,
        };
      }
    }

    const fileReader = getAssistant("FileReader");
    if (!fileReader.assistantId) {
      throw new Error("FileReader assistant not initialized");
    }

    const instructions = prompt
      ? `Please generate a detailed analysis of this file and its contents. Once that's done, respond to this prompt: ${prompt}`
      : `Please generate a detailed analysis of this file and its contents.`;

    const {
      result: fileDescription,
      threadId: newThreadId,
      isPreviousThreadExpired,
      isNewThreadCreated,
      fileId: appliedFileId,
    } = await executeFileReaderRun({
      ...(existingThreadId ? { threadId: existingThreadId } : {}),
      fileUrl,
      content: existingThreadId
        ? `Please generate a detailed analysis of this file and its contents. Once that's done, respond to this prompt: ${prompt}`
        : `File URL: ${fileUrl}`,
      instructions,
      attachment,
    });

    if (existingThreadId && isPreviousThreadExpired) {
      await poolQuery("DELETE FROM ai_chat_files WHERE threadId = ?", [
        existingThreadId,
      ]);
    }

    let fileId = appliedFileId || fileRow?.fileId;
    let fileRowInsertId = 0;
    if ((!fileRow || isNewThreadCreated) && fileId) {
      const { insertId = 0 } = await poolQuery(
        `INSERT INTO ai_chat_files (
          description,
          filePath,
          fileName,
          fileId,
          threadId,
          channelId,
          topicId
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          fileDescription,
          filePath,
          fileName,
          appliedFileId,
          newThreadId,
          channelId,
          topicId || null,
        ]
      );
      fileId = attachment?.file_id;
      fileRowInsertId = insertId;
    }

    return {
      threadId: newThreadId,
      description: fileDescription,
      isNew: !fileRow,
      fileId,
      fileRowInsertId,
    };
  } catch (error) {
    console.error("Error in getOrCreateFileThread:", error);
    throw error;
  }
}

export async function attachFile({ filePath }: { filePath: string }) {
  try {
    const extension = path.extname(filePath).toLowerCase().slice(1);
    const isFileSearch = FILE_SEARCH_SUPPORTED_EXTENSIONS.has(extension);
    const isCodeInterpreter =
      CODE_INTERPRETER_SUPPORTED_EXTENSIONS.has(extension);

    if (!isFileSearch && !isCodeInterpreter) {
      return null;
    }

    const response = await request.get(filePath, {
      responseType: "arraybuffer",
    });

    const fileBuffer = Buffer.from(response.data);

    const tempFileName = `${uuidv4()}_${path.basename(filePath) || "file"}`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    fs.writeFileSync(tempFilePath, new Uint8Array(fileBuffer));

    const fileStream = fs.createReadStream(tempFilePath);

    const file = await openai.files.create({
      file: fileStream,
      purpose: "assistants",
    });

    fs.unlinkSync(tempFilePath);

    const tools = [];
    if (isCodeInterpreter) tools.push({ type: "code_interpreter" });
    if (isFileSearch) tools.push({ type: "file_search" });

    const attachment = {
      file_id: file.id,
      tools,
    };
    return attachment;
  } catch (error) {
    console.error("Error uploading and attaching file:", error);
    return null;
  }
}

export async function getOrCreateThread({
  threadKey,
  isReply,
  messages,
  user,
  AIUserId,
}: {
  threadKey?: string;
  isReply?: boolean;
  messages: any[];
  user?: User;
  AIUserId?: number;
}) {
  let currentThreadId = "";

  if (threadKey) {
    const [threadRow] = await poolQuery(
      "SELECT threadId FROM ai_threads WHERE threadKey = ?",
      [threadKey]
    );
    currentThreadId = threadRow ? threadRow.threadId : "";
  }

  if (!currentThreadId) {
    const { formattedMessages } = await formatMessages({
      messages,
      model: GPT4,
      user,
      AIUserId: AIUserId,
    });
    const thread = await openai.beta.threads.create({
      messages: formattedMessages as any[],
    });
    currentThreadId = thread.id;
    if (threadKey) {
      await poolQuery(
        "INSERT INTO ai_threads (threadKey, threadId) VALUES (?, ?)",
        [threadKey, currentThreadId]
      );
    }
  } else {
    if (isReply) {
      const { formattedMessages } = await formatMessages({
        messages,
        model: GPT4,
        user,
        AIUserId: AIUserId,
      });
      for (const message of formattedMessages) {
        await createThreadMessage({
          threadId: currentThreadId,
          content: message,
        });
      }
    } else {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        const { formattedMessages } = await formatMessages({
          messages: [lastMessage],
          model: GPT4,
          user,
          AIUserId: AIUserId,
        });
        const formattedMessage = formattedMessages[0];
        if (Array.isArray(formattedMessage.content)) {
          const textParts = await Promise.all(
            formattedMessage.content.map(async (part: any) => {
              if (part.type === "image_url") {
                const description = await getImageDescription(
                  part.image_url.url
                );
                return { type: "text", text: description };
              }
              return part;
            })
          );
          formattedMessage.content = textParts;
        }

        await createThreadMessage({
          threadId: currentThreadId,
          content: formattedMessage,
        });
      }
    }
  }
  return currentThreadId;
}

export function cleanJSONString(jsonString: string): string {
  // eslint-disable-next-line no-control-regex
  return jsonString.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
}

export function compareStructure(target: any, expected: any): boolean {
  const type1 = getType(target);
  const type2 = getType(expected);

  if (type1 !== type2) {
    return false;
  }

  if (type1 === "array" && type2 === "array") {
    return (
      target.length === 0 ||
      expected.length === 0 ||
      compareStructure(target[0], expected[0])
    );
  }

  if (type1 === "object" && type2 === "object") {
    const obj1Keys = Object.keys(target);
    const obj2Keys = Object.keys(expected);

    if (obj1Keys.length !== obj2Keys.length) return false;

    for (const key of obj1Keys) {
      if (!(key in expected)) return false;
      if (
        typeof expected[key] === "object" &&
        !Object.keys(expected[key]).length
      ) {
        return true;
      }
      if (!expected[key]) return true;
      if (!compareStructure(target[key], expected[key])) return false;
    }
  }

  return true;
}

export function getType(obj: any): string {
  if (Array.isArray(obj)) return "array";
  if (isObject(obj)) return "object";
  return "primitive";
}

export function isObject(obj: any): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

export function shuffleArray(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export async function fetchWebpageText(url: string) {
  try {
    const response = await request.get(url);
    const html = response.data;
    const $ = load(html);

    $("script, style, iframe").remove();

    const contentElements = [
      "p",
      "div",
      "main",
      "span",
      "font",
      "article",
      "section",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
    ];

    let maxContentLength = 0;
    let textElement = null;
    $("body *").each((_, element) => {
      const contentLength = $(element)
        .find(contentElements.join(","))
        .text()
        .trim().length;
      if (contentLength > maxContentLength) {
        maxContentLength = contentLength;
        textElement = element;
      }
    });

    const webpageText = textElement
      ? $(textElement)
          .text()
          .replace(/\s{2,}/g, "")
          .trim()
      : "";

    return webpageText;
  } catch (error) {
    console.error("Error fetching article text:", error);
    throw error;
  }
}

export async function getPreviousMessages({
  AIMessageId,
  channelId,
  topicId,
}: {
  AIMessageId: number;
  channelId: number;
  topicId?: number | null;
}) {
  let prevMessages = await poolQuery(
    `SELECT * FROM msg_chats WHERE id < ? AND channelId = ?${
      topicId ? " AND subjectId = ?" : " AND subjectId IS NULL"
    } AND isNotification != '1' AND isDeleted != '1' ORDER BY id DESC LIMIT 20`,
    [AIMessageId, channelId, topicId],
    true
  );

  const isReply = !!prevMessages[0]?.targetMessageId;

  if (isReply) {
    const replyMessage = prevMessages[0];
    prevMessages = [
      replyMessage,
      ...(await poolQuery(
        `SELECT * FROM msg_chats WHERE id <= ? AND channelId = ?${
          topicId ? " AND subjectId = ?" : " AND subjectId IS NULL"
        } AND isNotification != '1' AND isDeleted != '1' ORDER BY id DESC LIMIT 4`,
        [prevMessages[0].targetMessageId, channelId, topicId]
      )),
    ];
  }

  return {
    prevMessages: prevMessages.reverse(),
    isReply,
  };
}

export async function insertNewEmptyAIMessage({
  channelId,
  topicId,
  AIUserId,
}: {
  channelId: number;
  topicId?: number | null;
  AIUserId: number;
}) {
  const AIsMessage = {
    channelId,
    subjectId: topicId || null,
    userId: AIUserId,
    content: "",
    timeStamp: Math.floor(Date.now() / 1000),
  };
  const { insertId: AIMessageId } = await poolQuery(
    `INSERT INTO msg_chats SET ?`,
    AIsMessage
  );
  return { AIsMessage, AIMessageId };
}

export async function createGPTCompletionWithRetry({
  maxAttempts = 3,
  messages,
  functions = [],
  model = APPLIED_MODEL,
  temperature = 0.7,
  timeout = 120000,
  topP = 1,
}: {
  maxAttempts?: number;
  messages: {
    role: string;
    content: any;
  }[];
  functions?: any[];
  model?: string;
  temperature?: number;
  timeout?: number;
  topP?: number;
}): Promise<{
  response: string;
  model: string;
}> {
  let appliedModel = model;

  const apiCall = (model: string) => {
    const requestBody: {
      model: string;
      messages: {
        role: string;
        content: string | object;
      }[];
      functions?: any[];
      temperature: number;
      max_tokens?: number;
      top_p: number;
    } = {
      model,
      messages,
      temperature,
      top_p: topP,
    };

    if (appliedModel !== O1_MINI && appliedModel !== O1_PREVIEW) {
      let maxOutputTokens = GPT4_MINI_MAX_OUTPUT_TOKENS;
      if (appliedModel === GPT4) {
        maxOutputTokens = GPT4_MAX_OUTPUT_TOKENS;
      }
      requestBody.max_tokens = maxOutputTokens;
    } else {
      requestBody.temperature = 1;
    }

    if (functions.length) {
      requestBody.functions = functions;
    }
    return openai.chat.completions.create(requestBody as any);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        appliedModel = APPLIED_MODEL;
      }
      const response: any = await Promise.race([
        apiCall(appliedModel),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("OpenAI request timed out")),
            timeout
          )
        ),
      ]);
      const result = response.choices
        .map(
          ({
            message,
          }: {
            message: {
              content: string;
              function_call?: {
                name: string;
                arguments: string;
              };
            };
          }) => {
            if (message.content) {
              return message.content.trim();
            }
            return "";
          }
        )
        .join(" ");
      return {
        response: (result || "").replace("```json", "").replace("```", ""),
        model: appliedModel,
      };
    } catch (error: any) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxAttempts) {
        return {
          response: `[ERROR] AI request failed: ${error.message}`,
          model: appliedModel,
        };
      }
    }
  }
  return {
    response:
      "[ERROR] Maximum retry attempts reached with no successful response",
    model: appliedModel,
  };
}

function fixMismatchedBrackets(jsonString: string): string {
  // Stack to keep track of opening brackets
  const stack: string[] = [];
  const chars = jsonString.split("");

  // First pass: Fix obvious mismatches
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "{" || chars[i] === "[") {
      stack.push(chars[i]);
    } else if (chars[i] === "}" || chars[i] === "]") {
      const lastOpening = stack.pop();
      // If we have a mismatch, fix it
      if (lastOpening === "{" && chars[i] === "]") {
        chars[i] = "}";
      } else if (lastOpening === "[" && chars[i] === "}") {
        chars[i] = "]";
      }
    }
  }

  return chars.join("");
}

export async function generateGPTResponseInObj({
  model = APPLIED_MODEL,
  prompt,
  expectedStructure,
  temperature = 0.7,
  retryCount = 0,
  MAX_RETRY_COUNT = 3,
  RETRY_COOLDOWN_MS = 3000,
}: {
  model?: string;
  prompt: string;
  expectedStructure: object;
  temperature?: number;
  retryCount?: number;
  MAX_RETRY_COUNT?: number;
  RETRY_COOLDOWN_MS?: number;
}): Promise<any> {
  const expectedStructureString = JSON.stringify(expectedStructure, null, 2);
  const fullPrompt = `Please generate a valid JSON object according to this specification: [[${prompt}]] The expected JSON structure is:\n\n${expectedStructureString}\n\nDon't talk. You are a JSON generator. Return ONLY valid JSON that matches the expected structure. No explanations or additional text.\n\n\`\`\`json\n\n`;

  try {
    const { response: generatedJSON } = await createGPTCompletionWithRetry({
      messages: [{ role: "user", content: fullPrompt }],
      model,
      temperature,
    });

    const jsonMatch = generatedJSON.match(/```(?:json)?\s*([\s\S]*?)```/) || [
      null,
      generatedJSON,
    ];
    const extractedJSON = jsonMatch[1].trim();

    let cleanedJSON = cleanJSONString(extractedJSON)
      .replace(/^\s*{\s*"/, '{"')
      .replace(/"\s*}\s*$/, '"}')
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/\[\s*,/g, "[")
      .replace(/,\s*\]/g, "]");

    cleanedJSON = fixMismatchedBrackets(cleanedJSON);

    let result;
    let isValid = false;

    try {
      result = JSON.parse(cleanedJSON);

      if (Array.isArray(expectedStructure) && !Array.isArray(result)) {
        result = [result];
      }

      isValid = compareStructure(result, expectedStructure);

      if (!isValid && result) {
        if (Array.isArray(expectedStructure) && !Array.isArray(result)) {
          result = [result];
          isValid = compareStructure(result, expectedStructure);
        } else if (
          !Array.isArray(expectedStructure) &&
          Array.isArray(result) &&
          result.length === 1
        ) {
          result = result[0];
          isValid = compareStructure(result, expectedStructure);
        }
      }
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      console.error("Generated JSON:", generatedJSON);
      console.error("Cleaned JSON:", cleanedJSON);

      try {
        const recoveredJSON = cleanedJSON
          .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
          .replace(/:\s*'([^']*)'/g, ':"$1"')
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/\]\s*{/g, "],[")
          .replace(/}\s*{/g, "},{");

        result = JSON.parse(recoveredJSON);
        isValid = compareStructure(result, expectedStructure);
      } catch (recoveryError) {
        console.error("Recovery attempt failed:", recoveryError);
      }
    }

    if (isValid) {
      return result;
    }

    if (retryCount < MAX_RETRY_COUNT) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_COOLDOWN_MS));

      const retryPrompt =
        retryCount === 0
          ? `Generate ONLY a valid JSON object. No markdown. No explanations. The structure must be: ${expectedStructureString}`
          : fullPrompt;

      return generateGPTResponseInObj({
        model,
        prompt: retryPrompt,
        expectedStructure,
        temperature: Math.max(0.1, temperature - 0.2),
        retryCount: retryCount + 1,
        MAX_RETRY_COUNT,
        RETRY_COOLDOWN_MS,
      });
    }

    throw new Error("Maximum retries reached with invalid responses");
  } catch (error) {
    console.error("Error in generateGPTResponseInObj:", error);
    if (retryCount < MAX_RETRY_COUNT) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_COOLDOWN_MS));
      return generateGPTResponseInObj({
        model,
        prompt,
        expectedStructure,
        temperature,
        retryCount: retryCount + 1,
        MAX_RETRY_COUNT,
        RETRY_COOLDOWN_MS,
      });
    }
    throw error;
  }
}

async function getImageDescription(imageUrl: string): Promise<string> {
  const { response: description } = await createGPTCompletionWithRetry({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image in detail:" },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    model: GPT4_MINI,
  });

  return `[Image Description: ${description}]`;
}

export async function getLatestFileThread({
  channelId,
  topicId,
}: {
  channelId: number;
  topicId?: number | null;
}) {
  const [fileRow] = await poolQuery(
    `SELECT a.*, b.actualFileName, c.id AS messageId, c.timeStamp, c.content AS messageContent
    FROM ai_chat_files a
    LEFT JOIN content_files b ON a.filePath = b.filePath
    LEFT JOIN msg_chats c ON a.filePath = c.filePath
    WHERE a.channelId = ? 
    AND (a.topicId = ? OR (? IS NULL AND a.topicId IS NULL))
    ORDER BY a.lastUsed DESC LIMIT 1`,
    [channelId, topicId, topicId]
  );

  if (!fileRow) return null;
  await poolQuery(`UPDATE ai_chat_files SET lastUsed = NOW() WHERE id = ?`, [
    fileRow.id,
  ]);
  socket.emit("update_last_used_file", {
    channelId,
    topicId,
    file: fileRow,
  });
  return fileRow.threadId;
}

export async function validateImageUrlWithRetry(url: string): Promise<boolean> {
  const IMAGE_VALIDATION_MAX_RETRIES = 3;
  const IMAGE_VALIDATION_RETRY_DELAY = 1000;
  for (let attempt = 1; attempt <= IMAGE_VALIDATION_MAX_RETRIES; attempt++) {
    try {
      const isValid = await validateImageUrl(url);
      if (isValid) return true;

      if (attempt < IMAGE_VALIDATION_MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, IMAGE_VALIDATION_RETRY_DELAY)
        );
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${url}:`, error);
      if (attempt < IMAGE_VALIDATION_MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, IMAGE_VALIDATION_RETRY_DELAY)
        );
      }
    }
  }
  return false;

  async function validateImageUrl(url: string): Promise<boolean> {
    const IMAGE_TIMEOUT = 5000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IMAGE_TIMEOUT);

      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) return false;

      const contentType = response.headers.get("content-type");

      if (!contentType?.startsWith("image/")) return false;

      return true;
    } catch (error) {
      console.error(`Error validating image URL ${url}:`, error);
      return false;
    }
  }
}

export async function executeFileReaderRun({
  threadId,
  content,
  instructions,
  fileUrl,
  attachment,
}: {
  threadId?: string;
  content: string;
  instructions?: string;
  fileUrl: string;
  attachment?: {
    file_id: string;
    tools: any[];
  };
}): Promise<{
  result: string;
  threadId: string;
  fileId: string;
  isNewThreadCreated: boolean;
  isPreviousThreadExpired: boolean;
}> {
  try {
    let run;
    let newThreadId = threadId;

    if (!threadId) {
      const createAndRunResponse = await openai.beta.threads.createAndRun({
        assistant_id: getAssistant("FileReader").assistantId as string,
        thread: {
          messages: [
            {
              role: "user",
              content,
              ...(attachment && { attachments: [attachment] }),
            },
          ],
        },
        ...(instructions && { instructions }),
      });
      run = createAndRunResponse;
      newThreadId = createAndRunResponse.thread_id;
    } else {
      await createThreadMessage({
        threadId,
        content,
        attachment,
      });

      run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: getAssistant("FileReader").assistantId as string,
        ...(instructions && { instructions }),
      });
    }

    const result = await executeOpenAIRun(run);
    return {
      result,
      threadId: newThreadId || "",
      isNewThreadCreated: !threadId,
      isPreviousThreadExpired: false,
      fileId: attachment?.file_id || "",
    };
  } catch (error) {
    if (threadId) {
      try {
        const newAttachment = await attachFile({ filePath: fileUrl });
        if (!newAttachment) {
          throw new Error("Failed to create new attachment");
        }

        const createAndRunResponse = await openai.beta.threads.createAndRun({
          assistant_id: getAssistant("FileReader").assistantId as string,
          thread: {
            messages: [
              {
                role: "user",
                content,
                attachments: [newAttachment as any],
              },
            ],
          },
          ...(instructions && { instructions }),
        });

        const result = await executeOpenAIRun(createAndRunResponse);
        return {
          result,
          threadId: createAndRunResponse.thread_id,
          fileId: newAttachment.file_id,
          isNewThreadCreated: true,
          isPreviousThreadExpired: true,
        };
      } catch (retryError) {
        console.error("Error during retry attempt:", retryError);
        throw retryError;
      }
    }

    throw error;
  }
}

export async function executeOpenAIRun(run: {
  thread_id: string;
  id: string;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const MAX_WAIT_TIME = 120000;
    const POLLING_INTERVAL = 1000;

    const timeout = setTimeout(() => {
      clearInterval(statusCheck);
      reject(new Error("Operation timed out"));
    }, MAX_WAIT_TIME);

    const statusCheck = setInterval(async () => {
      try {
        const runStatus = await openai.beta.threads.runs.retrieve(
          run.thread_id,
          run.id
        );

        if (runStatus.status === "completed") {
          clearInterval(statusCheck);
          clearTimeout(timeout);
          const messages = await openai.beta.threads.messages.list(
            run.thread_id
          );
          const assistantMessage = messages.data.find(
            (msg) => msg.role === "assistant" && msg.run_id === run.id
          );
          const textResponse =
            assistantMessage?.content[0]?.type === "text"
              ? assistantMessage.content[0].text
              : null;
          resolve(textResponse?.value || "");
        } else if (
          ["failed", "cancelled", "expired"].includes(runStatus.status)
        ) {
          clearInterval(statusCheck);
          clearTimeout(timeout);
          reject(new Error(`Run failed with status: ${runStatus.status}`));
        }
      } catch (error: any) {
        clearInterval(statusCheck);
        clearTimeout(timeout);

        if (error?.status === 400) {
          try {
            const runs = await openai.beta.threads.runs.list(run.thread_id);
            for (const existingRun of runs.data) {
              if (
                (existingRun.status === "in_progress" ||
                  existingRun.status === "queued") &&
                existingRun.id !== run.id
              ) {
                try {
                  await openai.beta.threads.runs.cancel(
                    run.thread_id,
                    existingRun.id
                  );
                } catch (cancelError) {
                  console.error(
                    `Failed to cancel run ${existingRun.id}:`,
                    cancelError
                  );
                }
              } else if (existingRun.status === "cancelling") {
                await poolQuery("DELETE FROM ai_threads WHERE threadId = ?", [
                  run.thread_id,
                ]);
                throw new Error(`Thread ${run.thread_id} is corrupted.`);
              }
            }

            const retryRun = await openai.beta.threads.runs.retrieve(
              run.thread_id,
              run.id
            );

            if (retryRun.status === "in_progress") {
              return;
            }
            reject(new Error("Run failed after cancelling previous runs"));
          } catch (cancelError: any) {
            reject(
              new Error(`Failed to handle run error: ${cancelError.message}`)
            );
          }
        } else {
          reject(error);
        }
      }
    }, POLLING_INTERVAL);
  });
}

export async function createThreadMessage({
  threadId,
  role = "user",
  content,
  attachment,
}: {
  threadId: string;
  role?: "user" | "assistant";
  content: string | { role: string; content: any };
  attachment?: { file_id: string; tools: any[] };
}) {
  const message =
    typeof content === "string"
      ? { role, content, ...(attachment && { attachments: [attachment] }) }
      : content;
  try {
    return await openai.beta.threads.messages.create(threadId, message as any);
  } catch (error: any) {
    if (error?.status === 400) {
      try {
        const runs = await openai.beta.threads.runs.list(threadId);

        for (const run of runs.data) {
          if (run.status === "in_progress" || run.status === "queued") {
            try {
              await openai.beta.threads.runs.cancel(threadId, run.id);
            } catch (cancelError) {
              console.error(`Failed to cancel run ${run.id}:`, cancelError);
            }
          } else if (run.status === "cancelling") {
            await poolQuery("DELETE FROM ai_threads WHERE threadId = ?", [
              threadId,
            ]);
            throw new Error(
              `Thread ${threadId} is corrupted. Removing thread.`
            );
          }
        }

        const retryResult = await openai.beta.threads.messages.create(
          threadId,
          message as any
        );
        return retryResult;
      } catch (cancelError: any) {
        throw new Error(
          `Failed to handle message creation error: ${cancelError.message}`
        );
      }
    }
  }
}

export function convertSegmentsToSrt(segments: any[]) {
  return segments
    .map((segment, idx) => {
      const start = formatSrtTime(segment.start);
      const end = formatSrtTime(segment.end);

      // The text already contains our special marker from the translation process
      // We'll keep it as is and replace it with \n\n in the final output
      const text = segment.text;

      return `${idx + 1}\n${start} --> ${end}\n${text}`;
    })
    .join("\n\n");

  function formatSrtTime(sec: number) {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);
    const milliseconds = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(
      3,
      "0"
    )}`;
  }
}
