import { Router } from 'express';
import { User, Comment } from '../../types';
import { fetchTTSChunks, generateSubtitlesFromAudio } from '../../helpers/ai';
import socket from '../../constants/socketClient';
import stream from 'stream';
import fs from 'fs';
import { generateBlackAICard } from '../chat/model/ai-card';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import archiver from 'archiver';
import {
  getMonthIndexFromDayIndex,
  getYearFromDayIndex,
  poolQuery,
  userQuery
} from '../../helpers';
import { requireAuth } from '../../auth';
import { postVocabularyFeed } from '../chat/model/vocabulary';
import { v4 as uuid } from 'uuid';
import { adjustTimeString, reviewTranslationQuality } from './model';

const execPromise = promisify(exec);
const router = Router();

/**
 * Simple utility function to clean up all files in a directory
 * @param directory Directory to clean
 * @returns Object with counts of cleaned files and directories
 */
function cleanupDirectory(directory: string): { files: number; dirs: number } {
  const stats = { files: 0, dirs: 0 };

  // Create directory if it doesn't exist
  if (!fs.existsSync(directory)) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      return stats; // Nothing to clean in a new directory
    } catch (err) {
      console.error(`Failed to create directory ${directory}:`, err);
      return stats;
    }
  }

  try {
    // Resolve the absolute path to avoid any path resolution issues
    const absoluteDir = path.resolve(directory);

    const items = fs.readdirSync(absoluteDir);

    if (items.length === 0) {
      return stats;
    }

    // Delete all files and directories
    for (const item of items) {
      const itemPath = path.join(absoluteDir, item);
      try {
        const itemStat = fs.statSync(itemPath);

        if (itemStat.isDirectory()) {
          // Clean subdirectory first
          const subStats = cleanupDirectory(itemPath);
          stats.files += subStats.files;
          stats.dirs += subStats.dirs;

          // Then remove the directory itself
          fs.rmdirSync(itemPath);
          stats.dirs++;
        } else {
          // Remove file
          fs.unlinkSync(itemPath);
          stats.files++;
        }
      } catch (itemErr) {
        console.error(`Error processing ${itemPath}:`, itemErr);
      }
    }

    return stats;
  } catch (err) {
    console.error(`Error cleaning directory ${directory}:`, err);
    return stats;
  }
}

// Clean up all temporary files on server start
(() => {
  try {
    const uploadsDir = 'uploads';
    // Clean up all files in the uploads directory
    const stats = cleanupDirectory(uploadsDir);

    console.log(
      `Cleanup completed: Removed ${stats.files} files and ${stats.dirs} directories`
    );
  } catch (err) {
    console.error('Error during temp file cleanup:', err);
  }
})();

// Admin route to manually trigger cleanup of all temp files
router.post('/maintenance/cleanup', requireAuth, async (req: any, res) => {
  try {
    // Only allow admins to manually trigger cleanup
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Clean up all files in the uploads directory
    const stats = cleanupDirectory('uploads');

    return res.json({
      success: true,
      message: `Cleanup completed successfully. Removed ${stats.files} files and ${stats.dirs} directories.`,
      details: {
        filesRemoved: stats.files,
        directoriesRemoved: stats.dirs
      }
    });
  } catch (error) {
    console.error('Error during manual cleanup:', error);
    return res.status(500).json({ error: 'Failed to perform cleanup' });
  }
});

router.post('/subtitle', requireAuth, async (req: any, res) => {
  let tempPath = '';
  let compressedPath = '';
  let chunkPaths: string[] = [];

  try {
    const {
      chunk,
      targetLanguage = 'original',
      filename,
      chunkIndex,
      totalChunks: reqTotalChunks,
      processAudio = true,
      contentType = 'video/mp4' // Default content type
    } = req.body;

    if (!chunk || !filename) {
      return res.status(400).send('Missing chunk data or filename');
    }

    // Validate file size
    const base64Data = chunk.split(',')[1] || '';
    const fileSize = Buffer.byteLength(base64Data, 'base64');
    const MAX_FILE_SIZE_MB = 250;
    const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

    if (fileSize > MAX_FILE_SIZE) {
      return res.status(413).send(`File exceeds ${MAX_FILE_SIZE_MB}MB limit`);
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const tempDir = 'uploads';
    let finalFilePath = '';

    // Handle chunked uploads
    if (chunkIndex !== undefined && reqTotalChunks !== undefined) {
      const sessionId = `${filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const sessionDir = path.join(tempDir, sessionId);
      const reqChunkIndex = parseInt(chunkIndex || '0', 10);
      const reqTotalChunksNum = parseInt(reqTotalChunks || '1', 10);

      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const chunkPath = path.join(sessionDir, `chunk-${reqChunkIndex}`);
      fs.writeFileSync(chunkPath, new Uint8Array(buffer));

      if (reqChunkIndex === reqTotalChunksNum - 1) {
        let fileExtension = '.mp4';
        if (contentType.includes('audio/')) {
          fileExtension = contentType.includes('mp3') ? '.mp3' : '.wav';
        } else if (contentType.includes('video/')) {
          fileExtension = contentType.includes('webm') ? '.webm' : '.mp4';
        }

        finalFilePath = path.join(
          tempDir,
          `${sessionId}-complete${fileExtension}`
        );
        const writeStream = fs.createWriteStream(finalFilePath);
        const missingChunks = [];

        for (let i = 0; i < reqTotalChunksNum; i++) {
          const currentChunkPath = path.join(sessionDir, `chunk-${i}`);
          if (fs.existsSync(currentChunkPath)) {
            const chunkData = fs.readFileSync(currentChunkPath);
            writeStream.write(chunkData);
          } else {
            console.error(`Missing chunk ${i} at path: ${currentChunkPath}`);
            missingChunks.push(i);
          }
        }
        writeStream.end();

        if (missingChunks.length > 0) {
          return res
            .status(400)
            .send(`Missing chunks: ${missingChunks.join(', ')}`);
        }

        if (
          !fs.existsSync(finalFilePath) ||
          fs.statSync(finalFilePath).size === 0
        ) {
          return res
            .status(500)
            .send('Failed to create or validate combined file');
        }

        for (let i = 0; i < reqTotalChunksNum; i++) {
          const currentChunkPath = path.join(sessionDir, `chunk-${i}`);
          if (fs.existsSync(currentChunkPath)) fs.unlinkSync(currentChunkPath);
        }
        fs.rmdirSync(sessionDir);
      } else {
        return res.json({
          success: true,
          message: `Chunk ${reqChunkIndex} received`
        });
      }
    } else {
      finalFilePath = path.join(tempDir, `${Date.now()}-${filename}`);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      fs.writeFileSync(finalFilePath, new Uint8Array(buffer));
    }

    tempPath = finalFilePath;

    if (!processAudio) {
      return res.json({
        success: true,
        message: 'File received, audio processing skipped'
      });
    }

    // Emit progress updates
    if (req.user?.id) {
      socket.emit('subtitle_translation_progress', {
        userId: req.user.id,
        progress: 1,
        stage: 'Preparing audio file'
      });
    }

    socket.emit('subtitle_translation_progress', {
      userId: req.user.id,
      progress: 2,
      stage: 'Compressing audio'
    });

    compressedPath = await convertToCompressedAudio(tempPath);

    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
      tempPath = '';
    }

    socket.emit('subtitle_translation_progress', {
      userId: req.user.id,
      progress: 3,
      stage: 'Analyzing audio for natural breaks'
    });

    const chunkInfo = await analyzeAndChunkAudio(compressedPath);
    chunkPaths = chunkInfo.chunkPaths;
    const totalChunks = chunkPaths.length;

    socket.emit('subtitle_translation_progress', {
      userId: req.user.id,
      progress: 5,
      stage: 'Audio preprocessing complete',
      current: 0,
      total: totalChunks,
      warning:
        totalChunks > 15
          ? 'Large audio file detected. This may take several minutes.'
          : undefined
    });

    let fullSRT = '';
    let cumulativeDuration = 0;
    const delayAdjustment = 1; // Adjust this value (in seconds) based on testing

    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i];
      const trimmedChunkPath = await trimLeadingSilence(chunkPath);
      const chunkDuration = await getAudioDuration(chunkPath);

      socket.emit('subtitle_translation_progress', {
        userId: req.user.id,
        progress: Math.floor(5 + (i / totalChunks) * 40),
        stage: `Processing chunk ${i + 1} of ${totalChunks}`,
        current: i + 1,
        total: totalChunks
      });

      const progressRange = {
        start: 5 + (i / totalChunks) * 40,
        end: 5 + ((i + 1) / totalChunks) * 40
      };

      const rawSRT = await generateSubtitlesFromAudio({
        inputAudioPath: trimmedChunkPath,
        targetLanguage,
        userId: req.user?.id,
        progressRange
      });

      const adjustedSRT = adjustSubtitleTiming(
        rawSRT,
        cumulativeDuration,
        delayAdjustment
      );
      fullSRT += adjustedSRT + '\n\n';
      cumulativeDuration += chunkDuration;

      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
      if (fs.existsSync(trimmedChunkPath)) fs.unlinkSync(trimmedChunkPath);
      chunkPaths[i] = '';
    }

    socket.emit('subtitle_translation_progress', {
      userId: req.user.id,
      progress: 45,
      stage: 'Post-processing subtitles',
      current: totalChunks,
      total: totalChunks
    });

    const processedSRT = fullSRT.trim();
    let finalSRT = processedSRT;

    if (targetLanguage !== 'original') {
      socket.emit('subtitle_translation_progress', {
        userId: req.user.id,
        progress: 70,
        stage: 'Reviewing translation quality',
        current: totalChunks,
        total: totalChunks
      });
      finalSRT = await reviewTranslationQuality(processedSRT, req.user.id);
    }

    socket.emit('subtitle_translation_progress', {
      userId: req.user.id,
      progress: 100,
      stage: 'complete',
      current: totalChunks,
      total: totalChunks
    });

    return res.json({ srt: finalSRT });
  } catch (error) {
    console.error('Error processing chunk:', error);
    if (req.user?.id) {
      socket.emit('subtitle_translation_progress', {
        userId: req.user.id,
        progress: 0,
        stage: 'error',
        error:
          error instanceof Error ? error.message : 'Failed to process audio'
      });
    }
    return res.status(500).send('Failed to process chunk');
  } finally {
    const filesToCleanup = [tempPath, compressedPath, ...chunkPaths].filter(
      Boolean
    );
    for (const filePath of filesToCleanup) {
      if (filePath && fs.existsSync(filePath)) {
        try {
          if (fs.lstatSync(filePath).isDirectory()) {
            // Remove directory and its contents
            fs.rmdirSync(filePath, { recursive: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          console.error(`Failed to clean up path ${filePath}:`, err);
        }
      }
    }
  }

  async function analyzeAndChunkAudio(
    inputPath: string
  ): Promise<{ chunkPaths: string[] }> {
    // Placeholder: Implement audio chunking logic (e.g., splitting by silence)
    const chunkPath = inputPath.replace('.mp3', '_chunk1.mp3');
    await execPromise(
      `ffmpeg -y -i "${inputPath}" -acodec copy "${chunkPath}"`
    );
    return { chunkPaths: [chunkPath] };
  }

  function adjustSubtitleTiming(
    srtData: string,
    offsetSec: number,
    delayAdjustment: number = 0
  ): string {
    if (!srtData) return '';

    const lines = srtData.split('\n');
    const processedLines: string[] = [];
    let previousLineIndex = -1;
    let previousEndTime = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('-->')) {
        const [start, end] = line.split('-->').map((s) => s.trim());
        let adjustedStart = start;
        let adjustedEnd = end;

        if (offsetSec || delayAdjustment) {
          const totalOffset = offsetSec + delayAdjustment;
          adjustedStart = adjustTimeString(start, totalOffset);
          adjustedEnd = adjustTimeString(end, totalOffset);
        }

        if (previousLineIndex !== -1 && previousEndTime) {
          const prevEndSec = timeToSeconds(previousEndTime);
          const currStartSec = timeToSeconds(adjustedStart);

          if (currStartSec > prevEndSec) {
            const prevLine = processedLines[previousLineIndex];
            const [prevStart] = prevLine.split('-->').map((s) => s.trim());
            processedLines[previousLineIndex] =
              `${prevStart} --> ${adjustedStart}`;
          } else if (currStartSec < prevEndSec) {
            adjustedStart = previousEndTime;
          }
        }

        previousLineIndex = processedLines.length;
        previousEndTime = adjustedEnd;
        processedLines.push(`${adjustedStart} --> ${adjustedEnd}`);
      } else {
        processedLines.push(line);
      }
    }

    return processedLines.join('\n');
  }

  async function convertToCompressedAudio(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace(
      path.extname(inputPath),
      '_compressed.mp3'
    );
    await execPromise(
      `ffmpeg -y -i "${inputPath}" -c:a libmp3lame -b:a 128k "${outputPath}"`
    );
    return outputPath;
  }

  async function getAudioDuration(inputPath: string): Promise<number> {
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
    );
    return parseFloat(stdout.trim());
  }

  async function trimLeadingSilence(inputPath: string): Promise<string> {
    const trimmedPath = inputPath.replace('.mp3', '_trimmed.mp3');
    try {
      await execPromise(
        `ffmpeg -y -i "${inputPath}" -af "silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB" -c:a libmp3lame "${trimmedPath}"`
      );
      return trimmedPath;
    } catch (error) {
      console.error('Error trimming leading silence:', error);
      return inputPath; // Fallback to original if trimming fails
    }
  }

  function timeToSeconds(timeStr: string): number {
    const [hms, ms] = timeStr.split(',');
    const [hh, mm, ss] = hms.split(':').map(Number);
    return hh * 3600 + mm * 60 + ss + parseInt(ms) / 1000;
  }
});

router.post('/reward/card', async (req, res) => {
  try {
    const { currentDayIndex } = req.body;
    if (typeof currentDayIndex !== 'number') {
      return res
        .status(400)
        .json({ error: 'Must provide currentDayIndex as a number' });
    }

    const previousDayIndex = currentDayIndex - 1;

    const isLastDayOfMonth = isLastDayOfMonthCheck(previousDayIndex);
    const isLastDayOfYear = isLastDayOfYearCheck(previousDayIndex);

    if (!isLastDayOfMonth && !isLastDayOfYear) {
      return res.json({
        success: true,
        message: 'Not month-end or year-end; no processing required.'
      });
    }

    const existingEntries = await poolQuery(
      `SELECT * FROM content_words_reward_status 
       WHERE dayIndex = ? 
       AND rewardType IN ('monthly', 'yearly')`,
      [previousDayIndex]
    );

    if (existingEntries.length >= 2) {
      return res.json({
        success: true,
        message: 'Previous day already processed'
      });
    }

    const processedRewards = [];

    if (isLastDayOfMonth) {
      const monthlyExists = existingEntries.some(
        (e: any) => e.rewardType === 'monthly'
      );
      if (!monthlyExists) {
        const result = await processMonthlyReward(previousDayIndex);
        processedRewards.push(result);
      }
    }

    if (isLastDayOfYear) {
      const yearlyExists = existingEntries.some(
        (e: any) => e.rewardType === 'yearly'
      );
      if (!yearlyExists) {
        const result = await processYearlyReward(previousDayIndex);
        processedRewards.push(result);
      }
    }

    if (processedRewards.length) {
      for (const reward of processedRewards) {
        await postVocabularyFeed({
          user: await userQuery({ userId: reward.championId }),
          action: 'reward',
          dayIndex: previousDayIndex,
          timeStamp: Math.floor(Date.now() / 1000),
          year: getYearFromDayIndex(previousDayIndex),
          month: getMonthIndexFromDayIndex(previousDayIndex),
          card: reward.card,
          rewardType: reward.type
        });
      }
    }

    return res.json({
      success: true,
      processedRewards,
      message: `Processed ${processedRewards.length} reward(s)`
    });
  } catch (err) {
    console.error('Error processing reward request:', err);
    return res.status(500).json({ error: 'Failed to process reward request' });
  }

  function isLastDayOfMonthCheck(dayIndex: number): boolean {
    const thisMonth = getMonthIndexFromDayIndex(dayIndex);
    const nextMonth = getMonthIndexFromDayIndex(dayIndex + 1);
    return thisMonth !== nextMonth;
  }

  function isLastDayOfYearCheck(dayIndex: number): boolean {
    const thisYear = getYearFromDayIndex(dayIndex);
    const nextYear = getYearFromDayIndex(dayIndex + 1);
    return thisYear !== nextYear;
  }

  async function processMonthlyReward(dayIndex: number) {
    const year = getYearFromDayIndex(dayIndex);
    const month = getMonthIndexFromDayIndex(dayIndex);

    const champion = await calculateChampion('monthly', year, month);
    if (champion) {
      const timestamp = Math.floor(Date.now() / 1000);
      const { insertId } = await poolQuery(
        `INSERT INTO content_words_reward_status 
         (rewardType, championId, cardId, dayIndex, timeStamp)
         VALUES (?, ?, ?, ?, ?)`,
        ['monthly', champion.id, null, dayIndex, timestamp]
      );

      try {
        const { card } = await generateBlackAICard({
          user: champion,
          isElite: true
        });

        await poolQuery(
          `UPDATE content_words_reward_status 
           SET cardId = ?
           WHERE id = ?`,
          [card.id, insertId]
        );

        return { type: 'monthly', championId: champion.id, card };
      } catch (error) {
        console.error('Error generating monthly reward card:', error);
        return { type: 'monthly', championId: champion.id, card: null };
      }
    }

    await insertPlaceholder(dayIndex, 'monthly');
    return { type: 'monthly', championId: null, card: null };
  }

  async function processYearlyReward(dayIndex: number) {
    const year = getYearFromDayIndex(dayIndex);

    const champion = await calculateChampion('yearly', year);
    if (champion) {
      const timestamp = Math.floor(Date.now() / 1000);
      const { insertId } = await poolQuery(
        `INSERT INTO content_words_reward_status 
         (rewardType, championId, cardId, dayIndex, timeStamp)
         VALUES (?, ?, ?, ?, ?)`,
        ['yearly', champion.id, null, dayIndex, timestamp]
      );

      try {
        const { card } = await generateBlackAICard({
          user: champion,
          isLegendary: true
        });

        await poolQuery(
          `UPDATE content_words_reward_status 
           SET cardId = ?
           WHERE id = ?`,
          [card.id, insertId]
        );

        return { type: 'yearly', championId: champion.id, card };
      } catch (error) {
        console.error('Error generating yearly reward card:', error);
        return { type: 'yearly', championId: champion.id, card: null };
      }
    }

    await insertPlaceholder(dayIndex, 'yearly');
    return { type: 'yearly', championId: null, card: null };
  }

  async function calculateChampion(
    type: 'monthly' | 'yearly',
    year: number,
    month?: number
  ) {
    const sql = `
      WITH ranking AS (
        SELECT
          u.id,
          SUM(
            CASE WHEN cwc.multiplyByWordLevel = 1
              THEN cwc.basePoints * GREATEST(w.wordLevel, 1)
              ELSE cwc.basePoints
            END
          ) AS totalPoints,
          RANK() OVER (ORDER BY SUM(
            CASE WHEN cwc.multiplyByWordLevel = 1
              THEN cwc.basePoints * GREATEST(w.wordLevel, 1)
              ELSE cwc.basePoints
            END
          ) DESC) AS ranking_position
        FROM users u
        JOIN content_words_feeds cwf ON cwf.userId = u.id
        LEFT JOIN content_words w ON w.id = cwf.wordId
        LEFT JOIN content_words_config cwc ON cwc.action = cwf.action
        WHERE cwf.year = ?
        ${type === 'monthly' ? 'AND cwf.month = ?' : ''}
        GROUP BY u.id
      )
      SELECT id, totalPoints
      FROM ranking
      WHERE ranking_position = 1
      LIMIT 1
    `;

    const params = type === 'monthly' ? [year, month] : [year];
    const results = await poolQuery(sql, params);

    if (!results || results.length === 0) return null;

    const user = await userQuery({ userId: results[0].id });
    return user;
  }

  async function insertPlaceholder(
    dayIndex: number,
    rewardType?: 'monthly' | 'yearly'
  ) {
    const insertions = [];
    const timestamp = Math.floor(Date.now() / 1000);

    if (!rewardType) {
      insertions.push(
        poolQuery(
          `INSERT INTO content_words_reward_status 
           (rewardType, championId, cardId, dayIndex, timeStamp)
           VALUES (?, ?, ?, ?, ?)`,
          ['monthly', 0, null, dayIndex, timestamp]
        ),
        poolQuery(
          `INSERT INTO content_words_reward_status 
           (rewardType, championId, cardId, dayIndex, timeStamp)
           VALUES (?, ?, ?, ?, ?)`,
          ['yearly', 0, null, dayIndex, timestamp]
        )
      );
    } else {
      insertions.push(
        poolQuery(
          `INSERT INTO content_words_reward_status 
           (rewardType, championId, cardId, dayIndex, timeStamp)
           VALUES (?, ?, ?, ?, ?)`,
          [rewardType, 0, null, dayIndex, timestamp]
        )
      );
    }

    await Promise.all(insertions);
  }
});

router.post('/tts', async (req, res) => {
  const MAX_RETRIES = 3;
  const { text, voice } = req.body;

  let attempt = 0;
  let success = false;
  let buffers: any[] = [];

  while (attempt < MAX_RETRIES && !success) {
    try {
      attempt += 1;
      buffers = await fetchTTSChunks(text, voice);
      success = true;
    } catch (error: any) {
      console.error(
        `Attempt ${attempt} failed at ${req.originalUrl}:`,
        error.message
      );
      if (attempt >= MAX_RETRIES) {
        return res
          .status(500)
          .send({ error: 'Failed to generate TTS after multiple attempts.' });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const combinedBuffer = Buffer.concat(buffers);
  const readStream = new stream.PassThrough();
  readStream.end(combinedBuffer);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', 'attachment; filename="output.mp3"');
  readStream.pipe(res);
});

router.get('/profile', requireAuth, async (req: any, res) => {
  const {
    user: Zero
  }: {
    user: User;
  } = req;
  let targetComment = null;
  let rootComment = null;
  let myPreviousComment = null;
  let isReply = false;
  try {
    const oneWeekInSeconds = 60 * 60 * 24 * 7;
    const lastActiveMinusOneWeek = Math.max(
      Zero.lastActive - oneWeekInSeconds,
      0
    );
    const comments = await poolQuery(
      `SELECT cc.*
        FROM content_comments cc
        LEFT JOIN content_comments cc2 ON cc.id = cc2.commentId AND cc2.rootType = 'user' AND cc2.rootId = ? AND cc2.isDeleted != '1'
        WHERE 
          cc.timeStamp > ?
          AND cc.commentId = '0'
          AND cc.isDeleted != '1'
          AND cc.rootType = 'user'
          AND cc.rootId = ?
          AND cc.userId != ?
          AND cc2.id IS NULL
        ORDER BY cc2.id DESC
        LIMIT 1`,
      [Zero.id, lastActiveMinusOneWeek, Zero.id, Zero.id]
    );
    if (comments[0]) {
      targetComment = comments[0];
    } else {
      const replies = await poolQuery(
        `SELECT * FROM content_comments a WHERE timeStamp > ? AND commentId != '0' AND isDeleted != '1' AND rootType = 'user' AND rootId = ? AND userId != ? AND (SELECT COUNT(*) FROM content_comments WHERE replyId = a.id AND isDeleted != '1') = 0 ORDER BY id DESC`,
        [lastActiveMinusOneWeek, Zero.id, Zero.id]
      );
      if (replies.length === 0) {
        return res.send({
          comment: null,
          username: null
        });
      }
      const commentIds = replies.map(
        (reply: Comment) => reply.replyId || reply.commentId
      );
      const uniqueCommentIds = [...new Set(commentIds)];
      const comments: Comment[] = await poolQuery(
        `        SELECT * FROM content_comments 
        WHERE id IN (?) AND isDeleted != '1'
      `,
        [uniqueCommentIds]
      );

      const commentsMap = new Map(
        comments.map((comment) => [comment.id, comment])
      );

      for (const reply of replies) {
        const comment = commentsMap.get(reply.replyId || reply.commentId);
        if (
          !comment ||
          (comment.userId !== Zero.id && comment.userId !== reply.userId)
        ) {
          continue;
        }

        isReply = true;
        rootComment = comment;

        if (reply.replyId) {
          rootComment = commentsMap.get(reply.commentId);
        }

        if (
          comment.userId !== Zero.id &&
          comment.userId !== rootComment?.userId
        ) {
          continue;
        }

        targetComment = reply;

        if (comment.userId === Zero.id) {
          myPreviousComment = comment;
        } else if (comment.userId && comment.userId === targetComment?.userId) {
          targetComment.content = `${comment.content} ${targetComment.content}`;
        }

        break;
      }
    }
    if (!targetComment) {
      return res.send({
        comment: null,
        username: null
      });
    }
    const sender = await userQuery({ userId: targetComment?.userId });
    res.send({
      userLevel: sender.level,
      comment: targetComment,
      username: sender.username,
      isReply,
      rootComment,
      myPreviousComment
    });
  } catch (error) {
    console.error(`Error at ${req.originalUrl}:`, error);
    return res.status(500).send({ error });
  }
});

router.get('/profile/response', requireAuth, async (req: any, res) => {
  const {
    user,
    query: { commentId }
  }: {
    user: User;
    query: { commentId: string };
  } = req;
  try {
    const [comment] = await poolQuery(
      `SELECT * FROM content_comments WHERE (commentId = ? OR replyId = ?) AND userId = ? AND isDeleted != '1'`,
      [commentId, commentId, user.id]
    );
    res.send(comment);
  } catch (error) {
    console.error(`Error at ${req.originalUrl}:`, error);
    return res.status(500).send({ error });
  }
});

router.put('/subtitle/split', async (req, res) => {
  let tempDir = '';
  try {
    const { srt, numSplits } = req.body;

    if (!srt || !numSplits || numSplits < 2) {
      return res.status(400).json({
        error: 'Missing srt content or invalid numSplits (must be >= 2)'
      });
    }

    const splits = splitSRT(srt, numSplits);

    tempDir = path.join('uploads', `split-${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const zipFilePath = path.join(tempDir, 'splits.zip');
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Set up cleanup function that we can use in multiple places
    const cleanupTempDir = () => {
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.error(`Error cleaning up tempDir ${tempDir}:`, cleanupErr);
        }
      }
    };

    // Set up a timeout to ensure cleanup happens even if download is interrupted
    const cleanupTimeout = setTimeout(
      () => {
        cleanupTempDir();
      },
      30 * 60 * 1000
    ); // 30 minutes max lifetime for temp files

    output.on('close', () => {
      res.download(zipFilePath, 'subtitle_splits.zip', (err) => {
        clearTimeout(cleanupTimeout); // Clear the timeout as we're explicitly cleaning up
        cleanupTempDir();
        if (err) console.error('Error sending zip:', err);
      });
    });

    output.on('error', (err) => {
      console.error('Error creating zip file:', err);
      clearTimeout(cleanupTimeout);
      cleanupTempDir();
      res.status(500).json({ error: 'Failed to create zip file' });
    });

    archive.pipe(output);

    splits.forEach((content, index) => {
      archive.append(content, { name: `part${index + 1}.srt` });
    });

    await archive.finalize();
  } catch (error) {
    console.error('Error processing SRT split:', error);
    // Ensure cleanup happens if there's an error
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error(`Error cleaning up tempDir on error:`, cleanupErr);
      }
    }
    return res.status(500).json({ error: 'Failed to split SRT file' });
  }

  function splitSRT(srtContent: string, numSplits: number): string[] {
    // Helper function for time conversion within this scope
    const timeToSeconds = (timeStr: string): number => {
      const [hms, ms] = timeStr.split(',');
      const [hh, mm, ss] = hms.split(':').map(Number);
      return hh * 3600 + mm * 60 + ss + parseInt(ms) / 1000;
    };

    // Normalize line endings and clean up any double spaces
    const normalizedContent = srtContent
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Parse SRT into structured entries
    const entries = normalizedContent
      .split(/\n\n+/)
      .map((block) => {
        const lines = block.split('\n');
        const index = parseInt(lines[0]);
        let timing = '';
        let text = '';

        // Find timing line (contains -->)
        const timingLineIndex = lines.findIndex((line) => line.includes('-->'));
        if (timingLineIndex > 0) {
          timing = lines[timingLineIndex];
          text = lines.slice(timingLineIndex + 1).join('\n');
        } else {
          timing = lines[1];
          text = lines.slice(2).join('\n');
        }

        return {
          index,
          timing,
          text: text.trim()
        };
      })
      .filter((entry) => !isNaN(entry.index) && entry.timing && entry.text);

    const totalEntries = entries.length;

    // Calculate target entries per split
    const targetEntriesPerSplit = Math.ceil(totalEntries / numSplits);
    const splits: string[] = [];
    let currentSplit: typeof entries = [];
    let currentSplitSize = 0;
    let currentSplitCount = 0;

    // Function to check if text ends with a sentence-ending punctuation
    const isEndOfSentence = (text: string) => /[.!?][\s"']*$/.test(text);

    // Function to check if we're in the middle of a semantic unit (like a paragraph)
    const isSemanticBreak = (
      curr: (typeof entries)[0],
      next: (typeof entries)[0]
    ) => {
      if (!next) return true;

      // Check for long pause between subtitles (more than 2 seconds)
      try {
        const currTimeParts = curr.timing.split('-->');
        const nextTimeParts = next.timing.split('-->');

        if (currTimeParts.length === 2 && nextTimeParts.length === 2) {
          const currEnd = currTimeParts[1].trim();
          const nextStart = nextTimeParts[0].trim();

          // Use the timeToSeconds function from the parent scope
          const currEndSec = timeToSeconds(currEnd);
          const nextStartSec = timeToSeconds(nextStart);

          if (nextStartSec - currEndSec > 2) {
            return true;
          }
        }
      } catch (e) {
        console.error('Error parsing timing in isSemanticBreak:', e);
      }

      // Check if current subtitle ends with sentence-ending punctuation
      return isEndOfSentence(curr.text);
    };

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      currentSplit.push(entry);
      currentSplitSize++;

      // Check if we should create a new split
      const isLastEntry = i === entries.length - 1;
      const hasReachedTarget = currentSplitSize >= targetEntriesPerSplit;
      const nextEntry = entries[i + 1];
      const isSemanticallyAppropriateToSplit = isSemanticBreak(
        entry,
        nextEntry
      );
      const remainingSplits = numSplits - currentSplitCount - 1;
      const remainingEntries = entries.length - i - 1;

      // Create a new split if:
      // 1. We've reached target size and found a good semantic break point, OR
      // 2. We're at the last entry, OR
      // 3. We need to split to ensure remaining splits have enough entries
      if (
        (hasReachedTarget && isSemanticallyAppropriateToSplit) ||
        isLastEntry ||
        (hasReachedTarget &&
          remainingEntries <= remainingSplits * targetEntriesPerSplit)
      ) {
        const splitContent = currentSplit
          .map((entry, idx) => `${idx + 1}\n${entry.timing}\n${entry.text}`)
          .join('\n\n');

        splits.push(splitContent);
        currentSplit = [];
        currentSplitSize = 0;
        currentSplitCount++;
      }
    }

    // Handle any remaining entries if we haven't created all splits
    while (splits.length < numSplits) {
      splits.push('');
    }

    return splits;
  }
});

router.put('/subtitle/merge', async (req, res) => {
  try {
    const { srt } = req.body;

    if (!Array.isArray(srt)) {
      return res.status(400).json({
        error: 'srt must be an array of SRT file contents'
      });
    }

    const mergedContent = mergeSRTs(srt);
    res.json({ srt: mergedContent });
  } catch (error) {
    console.error('Error processing SRT merge:', error);
    return res.status(500).json({ error: 'Failed to merge SRT files' });
  }

  function mergeSRTs(srtContents: string[]): string {
    let globalIndex = 1;
    const mergedContent = srtContents
      .map((content) => {
        return content
          .trim()
          .split('\n\n')
          .map((block) => {
            const [_, timing, ...textLines] = block.split('\n');
            return `${globalIndex++}\n${timing}\n${textLines.join('\n')}`;
          })
          .join('\n\n');
      })
      .join('\n\n');

    return mergedContent;
  }
});
router.post('/subtitle/merge-video', requireAuth, async (req: any, res) => {
  try {
    const {
      chunk, // Base64-encoded chunk
      srtContent, // Subtitle content (only with last chunk)
      sessionId, // Unique session identifier
      chunkIndex, // Index of the current chunk
      totalChunks, // Total number of chunks
      contentType, // MIME type of the video
      processVideo // Boolean to trigger merging
    } = req.body;

    // Validate required parameters
    if (
      !sessionId ||
      chunkIndex === undefined ||
      !totalChunks ||
      !contentType
    ) {
      return res.status(400).send('Missing required parameters');
    }

    // Set up session-specific temporary directory
    const tempDir = path.resolve('uploads', `session_${sessionId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Handle chunk storage
    if (chunk) {
      const chunkPath = path.join(tempDir, `chunk_${chunkIndex}`);
      const buffer = Buffer.from(chunk.split(',')[1] || chunk, 'base64'); // Handle data URI prefix if present
      fs.writeFileSync(chunkPath, buffer as any);
    }

    if (processVideo) {
      // Verify all chunks are present
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(tempDir, `chunk_${i}`);
        if (!fs.existsSync(chunkPath)) {
          return res.status(400).send(`Missing chunk ${i}`);
        }
      }

      // Assemble the video from chunks
      const fileExtension = contentType.includes('webm') ? '.webm' : '.mp4';
      const fullVideoPath = path.join(tempDir, `video${fileExtension}`);
      const chunks = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(tempDir, `chunk_${i}`);
        chunks.push(fs.readFileSync(chunkPath));
      }
      const videoBuffer = Buffer.concat(chunks as any);
      fs.writeFileSync(fullVideoPath, videoBuffer as any);

      // Write SRT file
      const tempSrtPath = path.join(tempDir, 'sub.srt');
      fs.writeFileSync(tempSrtPath, srtContent, 'utf8');

      // Convert SRT to ASS
      const tempAssPath = path.join(tempDir, 'sub.ass');
      await convertSrtToAss(tempSrtPath, tempAssPath); // Assuming this function exists

      // Prepare output file
      const fileId = uuid();
      const outputPath = path.join(tempDir, `${fileId}.mp4`);

      // Get video duration
      let totalDuration = 0;
      try {
        const { stdout } = await execPromise(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fullVideoPath}"`
        );
        totalDuration = parseFloat(stdout.trim()) || 60;
      } catch (error) {
        console.error('Error getting duration, defaulting to 60s:', error);
        totalDuration = 60;
      }

      // Get video resolution
      const resolutionCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${fullVideoPath}"`;
      const { stdout: resolutionOutput } = await execPromise(resolutionCmd);
      const [width, height] = resolutionOutput.trim().split('x').map(Number);

      // FFmpeg command to merge video with subtitles
      const ffmpegCommand = [
        '-y',
        '-i',
        path.resolve(fullVideoPath),
        '-vf',
        `scale=${width}:${height},subtitles='${path.resolve(tempAssPath).replace(/'/g, "'\\''")}'`,
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-f',
        'mp4',
        path.resolve(outputPath)
      ];

      await runFFmpegWithProgress(ffmpegCommand, totalDuration, req.user?.id); // Assuming this function exists

      // Validate output
      if (!fs.existsSync(outputPath)) {
        throw new Error(`Output file was not created: ${outputPath}`);
      }
      await validateMp4File(outputPath); // Assuming this function exists

      // Move output to uploads directory and generate URL
      const finalOutputPath = path.join('uploads', `${fileId}.mp4`);
      fs.renameSync(outputPath, finalOutputPath);
      const videoUrl = `/zero/subtitle-download/${fileId}`;

      // Clean up session directory
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Notify completion via socket (if applicable)
      if (req.user?.id) {
        socket.emit('subtitle_merge_progress', {
          progress: 100,
          stage: 'Complete',
          userId: req.user.id
        });
      }

      return res.json({ success: true, videoUrl });
    } else {
      // Acknowledge receipt of non-last chunks
      return res.json({ success: true });
    }
  } catch (error) {
    console.error('Error in video-subtitle merging:', error);
    if (req.user?.id) {
      socket.emit('subtitle_merge_progress', {
        userId: req.user.id,
        progress: 0,
        stage: 'error',
        error:
          error instanceof Error
            ? error.message
            : 'Failed to process video with subtitles'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to process video with subtitles'
    });
  }
});

async function validateMp4File(filePath: string) {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  try {
    const { stdout } = await execPromise(cmd);
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration) || duration <= 0) {
      throw new Error('Invalid MP4 file: duration is invalid');
    }
  } catch (error: any) {
    throw new Error(`Invalid MP4 file: ${filePath} - ${error.message}`);
  }
}

function runFFmpegWithProgress(
  ffmpegCommand: string[],
  totalDuration: number,
  userId: number
) {
  return new Promise((resolve, reject) => {
    try {
      // **Resolve Paths to Absolute Paths**
      for (let i = 0; i < ffmpegCommand.length; i++) {
        if (
          ffmpegCommand[i].includes('.') &&
          !path.isAbsolute(ffmpegCommand[i]) &&
          !ffmpegCommand[i].startsWith('-') &&
          fs.existsSync(ffmpegCommand[i])
        ) {
          ffmpegCommand[i] = path.resolve(ffmpegCommand[i]);
        }
      }

      // **Validate Inputs**
      const inputIndex = ffmpegCommand.indexOf('-i') + 1;
      const outputPath = ffmpegCommand[ffmpegCommand.length - 1];

      if (inputIndex > 0 && inputIndex < ffmpegCommand.length) {
        const inputPath = ffmpegCommand[inputIndex];
        if (!fs.existsSync(inputPath)) {
          throw new Error(`Input file does not exist: ${inputPath}`);
        }
      } else {
        throw new Error('No input file specified in FFmpeg command');
      }

      // **Validate Subtitle File in -vf**
      const filterIndex = ffmpegCommand.indexOf('-vf');
      if (filterIndex !== -1 && filterIndex + 1 < ffmpegCommand.length) {
        const filterValue = ffmpegCommand[filterIndex + 1];
        const subtitleMatch = filterValue.match(/subtitles=filename='(.+?)'/);
        if (subtitleMatch && subtitleMatch[1]) {
          const subtitlePath = subtitleMatch[1];
          if (!fs.existsSync(subtitlePath)) {
            throw new Error(`Subtitle file does not exist: ${subtitlePath}`);
          }
        }
      }

      // **Spawn FFmpeg Process**
      const ffmpeg = spawn('ffmpeg', ffmpegCommand);
      let stderrOutput = '';

      // **Set Timeout (1 Hour)**
      const TIMEOUT = 60 * 60 * 1000;
      const timeoutId = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        reject(new Error('FFmpeg process timed out after 1 hour'));
      }, TIMEOUT);

      // **Capture Stderr and Report Progress**
      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        stderrOutput += output;

        const timeMatch = output.match(/time=(\d+:\d+:\d+\.\d+)/);
        if (timeMatch && timeMatch[1]) {
          const currentTime = timeToSecondsForMerge(timeMatch[1]);
          const progress = Math.min(
            Math.round((currentTime / totalDuration) * 100),
            99
          );
          socket.emit('subtitle_merge_progress', {
            progress,
            stage: 'Encoding video with subtitles',
            userId
          });
        }
      });

      // **Handle Process Completion**
      ffmpeg.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          if (!fs.existsSync(outputPath)) {
            reject(new Error(`Output file was not created: ${outputPath}`));
            return;
          }
          const stats = fs.statSync(outputPath);
          if (stats.size < 10000) {
            reject(new Error(`Output file is too small: ${stats.size} bytes`));
            return;
          }
          resolve(true);
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderrOutput}`));
        }
      });

      // **Handle Spawn Errors**
      ffmpeg.on('error', (err) => {
        clearTimeout(timeoutId);
        console.error('FFmpeg process error:', err);
        reject(new Error(`FFmpeg spawn error: ${err.message}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Simplified download endpoint that uses the filesystem directly
router.get('/subtitle-download/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const filePath = path.join(path.resolve('uploads'), `${fileId}.mp4`);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${fileId}`);
    return res.status(404).send('File not found');
  }

  // Check file size to ensure it's valid
  try {
    const stat = fs.statSync(filePath);

    if (stat.size < 10000) {
      // Less than 10KB is likely an error
      console.error(`File too small (${stat.size} bytes): ${filePath}`);
      return res.status(500).send('Generated file is invalid');
    }

    // Set the Content-Disposition to trigger download with a user-friendly filename
    return res.download(filePath, `video-with-subtitles.mp4`, (err) => {
      if (err) {
        console.error(`Error sending file ${filePath}:`, err);
        if (!res.headersSent) {
          res.status(500).send('Error sending file');
        }
      }

      if (!err) {
        try {
          fs.unlinkSync(filePath);
          // Also delete the timestamp file if it exists
          const timestampPath = path.join(
            path.resolve('uploads'),
            `${fileId}.timestamp`
          );
          if (fs.existsSync(timestampPath)) {
            fs.unlinkSync(timestampPath);
          }
        } catch (deleteErr) {
          console.error(
            `Failed to delete file after download: ${filePath}`,
            deleteErr
          );
        }
      }
    });
  } catch (error) {
    console.error(`Error accessing file ${filePath}:`, error);
    return res.status(500).send('Error accessing file');
  }
});

// Add a cleanup function for old files
function cleanupOldFiles() {
  const uploadsDir = path.resolve('uploads');
  if (!fs.existsSync(uploadsDir)) return;

  const files = fs.readdirSync(uploadsDir);
  const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds

  files.forEach((file) => {
    const filePath = path.join(uploadsDir, file);

    // Handle timestamp files
    if (file.endsWith('.timestamp')) {
      try {
        const timestamp = parseInt(fs.readFileSync(filePath, 'utf8'));
        const age = Date.now() - timestamp;

        if (age > ONE_HOUR) {
          // Delete the associated MP4 file
          const fileId = file.replace('.timestamp', '');
          const videoPath = path.join(uploadsDir, `${fileId}.mp4`);

          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
          }

          // Delete the timestamp file
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`Error processing timestamp file ${filePath}:`, error);
      }
    }
    // Clean up other temp files (older than 2 hours to ensure they're not still in use)
    else if (file.startsWith('input_') || file.startsWith('sub_')) {
      try {
        const stats = fs.statSync(filePath);
        const fileAge = Date.now() - stats.mtime.getTime();

        if (fileAge > ONE_HOUR * 2) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`Error cleaning up temp file ${filePath}:`, error);
      }
    }
  });
}

// Run cleanup every hour
setInterval(cleanupOldFiles, 3600000);
// Run cleanup once at startup
cleanupOldFiles();

function timeToSecondsForMerge(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  return hours * 3600 + minutes * 60 + seconds;
}

// Keep the old route handler for backward compatibility
router.get('/temp/:fileId', (req, res) => {
  const fileId = req.params.fileId;

  if (!(global as any).tempFiles) {
    (global as any).tempFiles = {};
  }
  const fileInfo = (global as any).tempFiles[fileId];

  if (!fileInfo || !fs.existsSync(fileInfo.path)) {
    console.error(`File not found: ${fileId}`);
    return res.status(404).send('File not found');
  }

  // Check if expired
  if (fileInfo.expires < Date.now()) {
    delete (global as any).tempFiles[fileId];
    if (fs.existsSync(fileInfo.path)) {
      fs.unlinkSync(fileInfo.path);
    }
    console.error(`File expired: ${fileId}`);
    return res.status(410).send('File has expired');
  }

  try {
    // Check file size to ensure it's valid
    const stat = fs.statSync(fileInfo.path);

    if (stat.size < 10000) {
      // Less than 10KB is likely an error
      console.error(`File too small (${stat.size} bytes): ${fileInfo.path}`);
      return res.status(500).send('Generated file is invalid');
    }

    return res.download(fileInfo.path, path.basename(fileInfo.path), (err) => {
      if (err) {
        console.error(`Error sending file ${fileInfo.path}:`, err);
        if (!res.headersSent) {
          return res.status(500).send('Error sending file');
        }
      } else {
        // Clean up additional files only after successful download
        if (fileInfo.cleanupFiles && Array.isArray(fileInfo.cleanupFiles)) {
          fileInfo.cleanupFiles.forEach((filePath: string) => {
            if (filePath && fs.existsSync(filePath)) {
              try {
                if (fs.lstatSync(filePath).isDirectory()) {
                  // Remove directory and its contents
                  fs.rmdirSync(filePath, { recursive: true });
                } else {
                  fs.unlinkSync(filePath);
                }
              } catch (err) {
                console.error(
                  `Download cleanup: Failed to delete path ${filePath}:`,
                  err
                );
              }
            }
          });
        }

        // Keep the main file for a while in case of retry downloads
        // It will be cleaned up by the interval cleaner after expiration
      }
    });
  } catch (error) {
    console.error(`Error serving file ${fileInfo.path}:`, error);
    return res.status(500).send('Error serving file');
  }
});

async function convertSrtToAss(
  srtPath: string,
  assPath: string
): Promise<void> {
  try {
    // Read the SRT file
    const srtContent = fs.readFileSync(srtPath, 'utf8');

    // Parse SRT content
    const srtEntries = parseSrtForAss(srtContent);

    // Create ASS header with simpler styling for better compatibility
    const assHeader = `[Script Info]
Title: Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK KR Regular,56,&H00FFFFFF,&H000000FF,&H00000000,&H33000000,1,0,0,0,100,100,0,0,4,1,0,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    // Convert SRT entries to ASS events with simpler formatting
    const assEvents = srtEntries
      .map((entry, _index) => {
        const { startTime, endTime, text } = entry;
        // Convert SRT time format (00:00:00,000) to ASS time format (0:00:00.00)
        const assStartTime = convertSrtTimeToAssTime(startTime);
        const assEndTime = convertSrtTimeToAssTime(endTime);

        // Escape any curly braces in the text as they have special meaning in ASS
        const escapedText = text.replace(/{/g, '\\{').replace(/}/g, '\\}');

        // Use a simple dialogue line with no special overrides
        return `Dialogue: 0,${assStartTime},${assEndTime},Default,,0,0,0,,${escapedText}`;
      })
      .join('\n');

    // Combine header and events
    const assContent = assHeader + assEvents;

    // Write to ASS file
    fs.writeFileSync(assPath, assContent, 'utf8');
  } catch (error) {
    console.error('Error converting SRT to ASS:', error);
    throw error;
  }
}

// Helper function to parse SRT content for ASS conversion
function parseSrtForAss(
  srtContent: string
): Array<{ startTime: string; endTime: string; text: string }> {
  const entries: Array<{ startTime: string; endTime: string; text: string }> =
    [];
  const blocks = srtContent.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // Find the timing line (contains -->)
    const timingLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingLineIndex === -1) continue;

    const timingLine = lines[timingLineIndex];
    const [startTime, endTime] = timingLine.split('-->').map((t) => t.trim());

    // Get the text (all lines after the timing line)
    const text = lines.slice(timingLineIndex + 1).join('\\N');

    entries.push({ startTime, endTime, text });
  }

  return entries;
}

// Helper function to convert SRT time format to ASS time format
function convertSrtTimeToAssTime(srtTime: string): string {
  // SRT: 00:00:00,000 -> ASS: 0:00:00.00
  return srtTime.replace(/(\d+):(\d+):(\d+),(\d+)/, (_, h, m, s, ms) => {
    // Convert to ASS format (0:00:00.00) - only keep first 2 digits of milliseconds
    return `${parseInt(h, 10)}:${m}:${s}.${ms.substring(0, 2)}`;
  });
}

export default router;
