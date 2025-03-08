import { readPool, writePool } from '../pool';
import { Card, Content, User } from '../types';
import dbTables from '../constants/dbTables';
import levels from '../constants/userLevels';
import moment from 'moment';
import {
  advancedWordFrequency,
  currentVersion,
  epicWordFrequency,
  GOLD_MEMBER_XP_THRESHOLD,
  intermediateWordFrequency,
  rewardXps
} from '../constants';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import socket from '../constants/socketClient';
import nodemailer, { TransportOptions } from 'nodemailer';
import { mailAuth } from '../config';
import { Pool } from 'mysql2';
import { updateAchievementStatus } from './user';
const mentionRegex = /((?!([a-zA-Z1-9])).|^|\n)@[a-zA-Z0-9_]{3,}/;
const epochMs = Date.UTC(2022, 0, 1, 0, 0, 0);
const msInDay = 86400000;

async function aiCardQuery({
  cardId,
  userId,
  fromWriter
}: {
  cardId: number;
  userId?: number;
  fromWriter?: boolean;
}) {
  if (!cardId) return null;
  const [card] = await poolQuery(
    `SELECT * FROM ai_cards WHERE id = ?`,
    cardId,
    fromWriter
  );
  const [myOffer = null] = await poolQuery(
    `SELECT * FROM ai_card_offers WHERE cardId = ? AND isCancelled != '1' AND isAccepted != '1' AND userId = ?`,
    [cardId, userId || 0]
  );
  if (!card) return null;
  const result = {
    ...card,
    creator: await userQuery({ userId: card.creatorId }),
    owner: await userQuery({ userId: card.ownerId }),
    myOffer
  };
  return result;
}

async function managementLevelQuery(userId: number) {
  const [{ managementLevel = 0 } = {}] = await poolQuery(
    `
    SELECT b.managementLevel FROM users a JOIN users_types b ON a.userType = b.label
    WHERE a.id = ?  
  `,
    userId || 0
  );
  return managementLevel;
}

function can(user: User) {
  return (action: string) =>
    async function ({
      contentType,
      contentId
    }: {
      contentType?: string;
      contentId?: number;
    } = {}) {
      const actionHash: {
        [key: string]: string;
      } = {
        delete: 'canDelete',
        edit: 'canEdit'
      };
      const userLevelObj: { [key: string]: any } = getUserLevelObj(
        user.achievementPoints
      );
      if (action === 'reward') {
        return !!user.canReward || userLevelObj.canReward;
      }
      const { table, uploader } = dbTables[contentType || ''];
      const [{ [uploader as string]: uploaderId } = {}] = await poolQuery(
        `SELECT ${uploader} FROM ${table} WHERE id = ?`,
        contentId
      );
      if (!uploaderId) return false;
      if (user.id === uploaderId) return true;
      const [{ authLevel = 0, achievementPoints = 0 } = {}] = await poolQuery(
        `SELECT a.achievementPoints, b.authLevel, b.id, b.label
        FROM users a JOIN users_types b ON a.userType = b.label
        WHERE a.id = ?  
      `,
        uploaderId
      );
      const targetUserLevelObj: { [key: string]: any } =
        getUserLevelObj(achievementPoints);
      const selectedActionHash: string = actionHash[action];
      const canPerformSelectedAction =
        !!userLevelObj[selectedActionHash] || !!user[selectedActionHash];
      const targetUserLevel = Math.max(authLevel + 1, targetUserLevelObj.level);
      const isAuthorized = (user.level || 0) > targetUserLevel;
      return canPerformSelectedAction && isAuthorized;
    };
}

function getUserLevelObj(achievementPoints: number) {
  for (let i = levels.length - 1; i >= 0; i--) {
    if (achievementPoints >= levels[i].ap) {
      return {
        ...levels[i],
        level: levels[i].level,
        canEdit: levels[i].canEdit,
        canDelete: levels[i].canDelete,
        canReward: levels[i].canReward,
        canPinPlaylists: levels[i].canPinPlaylists,
        canEditRewardLevel: levels[i].canEditRewardLevel,
        managementLevel: levels[i].managementLevel,
        nextLevelAp: i === levels.length - 1 ? null : levels[i + 1].ap
      };
    }
  }
  return {
    ...levels[1],
    level: levels[1].level,
    canEdit: levels[1].canEdit,
    canDelete: levels[1].canDelete,
    canReward: levels[1].canReward,
    canPinPlaylists: levels[1].canPinPlaylists,
    canEditRewardLevel: levels[1].canEditRewardLevel,
    managementLevel: levels[1].managementLevel,
    nextLevelAp: levels[2].ap
  };
}

async function commentQuery({
  id,
  isLoadingComments,
  isPreview,
  exclude = []
}: {
  id: number;
  isLoadingComments?: boolean;
  isPreview?: boolean;
  exclude?: string | string[];
}) {
  const numRepliesLimit = 1;
  if (typeof exclude === 'string') {
    exclude = [exclude];
  }
  const include = ['uploader'];
  try {
    const [comment] = await poolQuery(
      `SELECT * FROM content_comments WHERE id = ?`,
      id
    );
    if (!comment || (!isLoadingComments && comment?.isDeleted)) {
      return Promise.resolve({
        notFound: true
      });
    }
    if (comment.settings?.mentions) {
      comment.content = await updateMentions({
        mentions: comment.settings.mentions,
        text: comment.content
      });
    }
    if (!isPreview) {
      include.push('replies', 'targetObj');
    }
    if (!comment.isDeleted) {
      include.push('rewards', 'recommendations', 'likes');
    }
    if (!isLoadingComments) {
      include.push('rootObj');
    }
    if (isLoadingComments && comment.isDeleted) {
      comment.isDeleted = false;
      comment.content = '';
      comment.isDeleteNotification = true;
    }
    const targetId = comment.replyId || comment.commentId;
    const queries: {
      [key: string]: () => Promise<any>;
    } = {
      likes: () =>
        likesQuery({ contentType: 'comment', contentId: comment.id }),
      recommendations: () =>
        recommendationsQuery({
          contentType: 'comment',
          contentId: comment.id
        }),
      replies: () =>
        repliesQuery({
          commentId: id,
          limit: numRepliesLimit + 1,
          isPreview: true
        }),
      rootObj: () =>
        contentQuery({
          contentType: comment.rootType,
          contentId: comment.rootId
        }),
      rewards: () =>
        rewardQuery({ contentType: 'comment', contentId: comment.id }),
      targetObj: async () => ({
        contentType: comment.replyId
          ? 'reply'
          : comment.commentId
            ? 'comment'
            : 'subject',
        subject: comment.subjectId
          ? await subjectQuery({
              subjectId: comment.subjectId,
              isPreview: !!isLoadingComments
            })
          : null,
        comment: targetId
          ? await commentQuery({
              id: targetId,
              isPreview: true,
              exclude: ['rootObj']
            })
          : null
      }),
      uploader: () => userQuery({ userId: comment.userId })
    };
    const params: {
      [key: string]: any;
    } = {};
    for (const param of include) {
      if (!exclude.includes(param)) {
        params[param] = await queries[param]();
      }
    }

    const numReplies = await numCommentQuery({
      contentType: 'comment',
      contentId: id,
      excludeRepliesOfReplies: true
    });

    return {
      ...comment,
      ...params,
      replies:
        params.replies?.length > numRepliesLimit
          ? params.replies?.slice(numRepliesLimit)
          : params.replies,
      numReplies,
      loadMoreButton: params.replies
        ? params.replies.length > numRepliesLimit
        : false
    };
  } catch (error) {
    return Promise.reject(error);
  }
}

async function contentQuery({
  contentType,
  contentId,
  rootType,
  includeRoot,
  includeDeleted
}: {
  contentType: string;
  contentId: number;
  rootType?: string;
  includeRoot?: boolean;
  includeDeleted?: boolean;
}): Promise<{
  [key: string]: any;
}> {
  let content: Content;
  if (contentType === 'user') {
    content = await userQuery({ userId: contentId, isFullLoad: true });
  } else {
    if (contentType !== 'pass' && !dbTables[contentType]) {
      console.error(`invalid content type: ${contentType}`);
      throw new Error(`invalid content type: ${contentType}`);
    }
    content = await getContentWithId({
      contentType,
      contentId,
      rootType,
      includeDeleted
    });
    content = await getContentWithClosedBy(content);
    content = await getContentWithRootMission(content);
  }
  if (contentType === 'xpChange') {
    const [rewardRow] = await poolQuery(
      `SELECT * FROM users_daily_rewards WHERE id = ?`,
      content.targetId
    );
    if (rewardRow) {
      const chosenCard = await aiCardQuery({
        cardId: rewardRow.chosenCardId
      });
      content.word = chosenCard.word;
      content.level = chosenCard.level;
      content.xpEarned = rewardRow.xpEarned;
      content.coinEarned = rewardRow.coinEarned;
      content.bonusQuestion = rewardRow.bonusQuestion[0];
    }
  }
  if (!content) return { notFound: true };
  if (content.settings?.mentions) {
    content.description = await updateMentions({
      mentions: content.settings.mentions,
      text: content.description as string
    });
  }
  if (contentType === 'pass') {
    content.rootType = rootType;
    content.rootId =
      rootType === 'mission' ? content.missionId : content.achievementId;
    content.timeStamp = content.reviewTimeStamp || content.timeStamp;
  }
  const numComments = Number(await numCommentQuery({ contentType, contentId }));
  const likes = await likesQuery({ contentType, contentId });
  const recommendations = await recommendationsQuery({
    contentType,
    contentId,
    rootType
  });
  const rewards = await rewardQuery({ contentType, contentId });
  const deleter =
    content.deleterId && includeDeleted
      ? await userQuery({ userId: content.deleterId })
      : null;
  const uploader =
    contentType === 'achievement'
      ? {}
      : await userQuery({
          userId:
            content[
              dbTables[
                contentType === 'pass'
                  ? rootType === 'achievement'
                    ? 'achievementUnlocked'
                    : 'missionAttempt'
                  : contentType
              ].uploader as string
            ]
        });
  const resultingContent = {
    ...content,
    contentType: contentType,
    numComments,
    likes,
    recommendations,
    rewards,
    deleter,
    uploader,
    ...(contentType === 'video'
      ? {
          views: await viewsQuery(contentId),
          questions: await questionsQuery(contentId)
        }
      : {}),
    ...(includeRoot && content.rootId && content.rootType
      ? {
          rootObj: await contentQuery({
            contentId: content.rootId,
            contentType: content.rootType
          })
        }
      : {})
  };
  return resultingContent;

  async function getContentWithId({
    contentType,
    contentId,
    rootType,
    includeDeleted
  }: {
    contentType: string;
    contentId: number;
    rootType?: string;
    includeDeleted?: boolean;
  }) {
    const and = includeDeleted ? '' : ` AND isDeleted != '1'`;
    const deletableContentTypes = ['url', 'video', 'subject', 'comment'];
    const contentCondition = deletableContentTypes.includes(contentType)
      ? and
      : '';

    const targetTable =
      dbTables[
        contentType === 'pass'
          ? rootType === 'achievement'
            ? 'achievementUnlocked'
            : 'missionAttempt'
          : contentType
      ].table;
    const [content] = await poolQuery(
      `SELECT * FROM ${targetTable} WHERE id = ?${contentCondition}`,
      contentId
    );
    return content;
  }

  async function getContentWithClosedBy(content: {
    isClosedBy?: User | number;
  }) {
    if (content?.isClosedBy) {
      content.isClosedBy = await userQuery({
        userId: content.isClosedBy as number
      });
    }
    return content;
  }

  async function getContentWithRootMission(content: {
    isTask?: boolean;
    rootMissionId?: number;
    rootMission?: any;
  }) {
    if (content?.isTask) {
      const rootMission = await contentQuery({
        contentId: content.rootMissionId as number,
        contentType: 'mission'
      });
      content.rootMission = rootMission;
    }
    return content;
  }
}

function getAge(dateString: string) {
  const birthDate = new Date(dateString);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function getDayIndexAndNextDay() {
  const now = Date.now();
  const dayIndex = Math.floor((now - epochMs) / msInDay);
  const nextDay = (dayIndex + 1) * msInDay + epochMs;
  return { dayIndex, nextDay };
}

function getMonthIndexFromDayIndex(dayIndex: number) {
  const dateMs = epochMs + dayIndex * msInDay;
  const date = new Date(dateMs);
  return date.getUTCMonth() + 1;
}

function getYearFromDayIndex(dayIndex: number) {
  const dateMs = epochMs + dayIndex * msInDay;
  const date = new Date(dateMs);
  return date.getUTCFullYear();
}

function getFileInfoFromFileName(fileName?: string) {
  if (typeof fileName !== 'string') return { extension: '', fileType: '' };
  const fileNameArray = fileName.split('.');
  const extension =
    fileNameArray[fileNameArray.length - 1]?.toLowerCase?.() || '';
  return { extension, fileType: getFileType(extension) };

  function getFileType(extension: string) {
    const audioExt = ['wav', 'aif', 'mp3', 'mid', 'm4a'];
    const imageExt = ['jpg', 'png', 'jpeg', 'bmp', 'gif', 'webp'];
    const movieExt = ['wmv', 'mov', 'mp4', '3gp', 'ogg', 'm4v'];
    const compressedExt = ['zip', 'rar', 'arj', 'tar', 'gz', 'tgz'];
    const wordExt = ['docx', 'docm', 'dotx', 'dotm', 'docb'];
    if (audioExt.includes(extension)) {
      return 'audio';
    }
    if (imageExt.includes(extension)) {
      return 'image';
    }
    if (movieExt.includes(extension)) {
      return 'video';
    }
    if (compressedExt.includes(extension)) {
      return 'archive';
    }
    if (wordExt.includes(extension)) {
      return 'word';
    }
    if (extension === 'pdf') {
      return 'pdf';
    }
    return 'other';
  }
}

function likesQuery({
  contentType,
  contentId,
  fromWriter
}: {
  contentType: string;
  contentId: number;
  fromWriter?: boolean;
}) {
  return poolQuery(
    `
      SELECT a.userId AS id, b.username,
      (SELECT src FROM users_photos WHERE userId = b.id AND isProfilePic = 1 LIMIT 1) AS profilePicUrl
      FROM content_likes a LEFT JOIN users b ON a.userId = b.id
      WHERE
      a.rootType = ? AND a.rootId = ? AND a.isDeleted != '1'
    `,
    [contentType, contentId],
    fromWriter
  );
}

async function numCommentQuery({
  contentType,
  contentId,
  excludeRepliesOfReplies
}: {
  contentType: string;
  contentId: number;
  excludeRepliesOfReplies?: boolean;
}) {
  switch (contentType) {
    case 'comment': {
      if (!excludeRepliesOfReplies) {
        const [{ numReplies = 0 } = {}] = await poolQuery(
          `SELECT COUNT(*) AS numReplies FROM content_comments WHERE replyId = ? AND isDeleted != '1'`,
          contentId
        );
        if (Number(numReplies > 0)) return Promise.resolve(Number(numReplies));
      }
      const [{ numComments = 0 } = {}] = await poolQuery(
        `SELECT COUNT(*) AS numComments FROM content_comments WHERE commentId = ? AND isDeleted != '1'${
          excludeRepliesOfReplies ? ' AND replyId = 0' : ''
        }`,
        contentId
      );
      return Promise.resolve(Number(numComments));
    }
    case 'subject': {
      const [{ numAnswers = 0 } = {}] = await poolQuery(
        `SELECT COUNT(*) AS numAnswers FROM content_comments WHERE subjectId = ? AND isDeleted != '1'`,
        contentId
      );
      return Promise.resolve(numAnswers);
    }
    default: {
      const [{ result = 0 } = {}] = await poolQuery(
        `SELECT COUNT(*) AS result FROM content_comments WHERE rootType = ? AND rootId = ? AND isDeleted != '1'`,
        [contentType, contentId]
      );
      return Promise.resolve(result);
    }
  }
}

function objectify({
  array,
  id = 'id',
  content
}: {
  array: any;
  id?: string;
  content?: any;
}) {
  const result: {
    [key: string]: any;
  } = {};
  for (const elem of array) {
    result[elem[id]] = content || elem;
  }
  return result;
}

type QueryParams =
  | Record<string, any>
  | Array<string | number | boolean | Date | null>
  | string
  | number
  | boolean
  | Date
  | null;
async function poolQuery(
  query = '',
  params: QueryParams = null,
  fromWriter = false
) {
  if (!query) {
    reportError({
      message: `poolQuery did not have a query. Params: ${JSON.stringify(
        params
      )}`
    });
    return Promise.reject(new Error('Missing query'));
  }

  const retryCount = 3;
  const retryDelay = 500;

  const executeQuery = async (
    query: string,
    params: QueryParams,
    pool: Pool
  ) => {
    return new Promise((resolve, reject) => {
      pool.query(query, params, (err: any, results: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      });
    });
  };

  const doQuery = async (
    retryCount: number,
    retryDelay: number
  ): Promise<any> => {
    try {
      if (process.env.NODE_ENV === 'production' && !fromWriter) {
        if (query.trim().substring(0, 6) === 'SELECT') {
          return await executeQuery(query, params, readPool);
        } else {
          return await executeQuery(query, params, writePool);
        }
      } else {
        return await executeQuery(query, params, writePool);
      }
    } catch (error: any) {
      console.error({
        message: 'Database query error',
        query,
        params: JSON.stringify(params),
        error,
        errorMessage: error.message,
        errorCode: error.code,
        retryCount: 3 - retryCount
      });

      if (error.code === 'ER_LOCK_DEADLOCK' && retryCount > 0) {
        await sleep(retryDelay);
        return doQuery(retryCount - 1, retryDelay * 2);
      } else {
        return Promise.reject(error);
      }
    }
  };

  try {
    return doQuery(retryCount, retryDelay);
  } catch (error) {
    console.error('Transaction management error:', error);
    throw error;
  }
}

async function processMentions(text: string) {
  let mentionsObj: {
    [key: string]: any;
  } | null = null;
  const targetText = text || '';
  if (mentionRegex.test(targetText)) {
    mentionsObj = {};
    const mentions: string[] = [];
    targetText.split(/\r?\n/).map((sentence) => {
      sentence.split(' ').map((word) => {
        const mention = word.trim();
        const extractedMention = mention.match(mentionRegex)?.[0];
        if (extractedMention) {
          mentions.push(extractedMention);
        }
      });
    });
    for (const mention of mentions) {
      const username = (mention.substring(1).match(/[a-zA-Z0-9_]/g) || []).join(
        ''
      );
      const [user] = await poolQuery(
        `SELECT id, username FROM users WHERE username = ?`,
        [username]
      );
      if (user) {
        mentionsObj[user.username] = { id: user.id };
      }
    }
  }
  return mentionsObj;
}

async function processAllMentions(lines: string[]) {
  const mentionsObj = {};

  for (const line of lines) {
    const lineMentions = await processMentions(line || '');
    Object.assign(mentionsObj, lineMentions);
  }

  return mentionsObj;
}

async function processMentionsOnEdit({
  text,
  contentId,
  contentType,
  userId,
  timeStamp
}: {
  text: string;
  contentId: number;
  contentType: string;
  userId: number;
  timeStamp: number;
}): Promise<{
  mentionsObj: Record<string, any> | null;
  loadedSettings: Record<string, any>;
}> {
  const { table } = dbTables[contentType];
  let prevMentionsObj = null;
  let mentionsObj: Record<string, any> | null = null;
  const [{ settings: loadedSettings = null } = {}] = await poolQuery(
    `SELECT settings FROM ${table} WHERE id = ?`,
    contentId,
    true
  );
  if (loadedSettings) {
    prevMentionsObj = loadedSettings.mentions;
  }
  if (mentionRegex.test(text)) {
    mentionsObj = {};
    const mentions: any[] = [];
    text.split(/\r?\n/).map((sentence) => {
      sentence.split(' ').map((word) => {
        const mention = word.trim();
        const extractedMention = mention.match(mentionRegex)?.[0];
        if (extractedMention) {
          mentions.push(extractedMention);
        }
      });
    });
    for (const mention of mentions) {
      const username = mention
        .substring(1)
        .match(/[a-zA-Z0-9_]/g)
        .join('');
      const [user] = await poolQuery(
        `SELECT id, username FROM users WHERE username = ?`,
        [username],
        true
      );
      if (user) {
        mentionsObj[user.username] = { id: user.id };
        if (contentType !== 'chat') {
          if (!prevMentionsObj?.[user.username]) {
            const rows = await poolQuery(
              `SELECT id FROM noti_mentions WHERE rootType = ? AND rootId = ? AND targetUserId = ?`,
              [contentType, contentId, user.id],
              true
            );
            if (rows.length === 0) {
              const { insertId: mentionInsertId } = await poolQuery(
                `INSERT INTO noti_mentions (rootType, rootId, targetUserId, userId, timeStamp)
                VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE rootType = ?, rootId = ?, targetUserId = ?, userId = ?, timeStamp = ?`,
                [
                  contentType,
                  contentId,
                  user.id,
                  userId,
                  timeStamp,
                  contentType,
                  contentId,
                  user.id,
                  userId,
                  timeStamp
                ]
              );
              mentionsObj[user.username].mentionId = mentionInsertId;
              mentionsObj[user.username].isNewMention = true;
            } else {
              mentionsObj[user.username].mentionId = rows[0].id;
            }
          } else {
            mentionsObj[user.username].mentionId =
              prevMentionsObj[user.username].mentionId;
          }
        }
      }
    }
    if (contentType !== 'chat') {
      for (const username in prevMentionsObj) {
        if (mentionsObj[username] || !prevMentionsObj[username].mentionId) {
          continue;
        }
        await poolQuery(
          `DELETE FROM noti_mentions WHERE id = ?`,
          prevMentionsObj[username].mentionId
        );
      }
    }
  }
  if (!mentionsObj && prevMentionsObj && contentType !== 'chat') {
    for (const username in prevMentionsObj) {
      if (!prevMentionsObj[username].mentionId) {
        continue;
      }
      await poolQuery(
        `DELETE FROM noti_mentions WHERE id = ?`,
        prevMentionsObj[username].mentionId
      );
    }
  }
  return Promise.resolve({ mentionsObj, loadedSettings });
}

async function promiseSeries<T>(array: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = [];
  if (array.length === 0) return Promise.resolve([]);
  for (const task of array) {
    try {
      const result = await task();
      results.push(result);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return Promise.resolve(results);
}

async function recommendationsQuery({
  contentType,
  contentId,
  rootType,
  fromWriter
}: {
  contentType: string;
  contentId: number;
  rootType?: string;
  fromWriter?: boolean;
}) {
  const params = [contentType, contentId];
  if (rootType) params.push(rootType);
  const results = await poolQuery(
    `
      SELECT a.id, a.userId, a.rewardDisabled, b.achievementPoints, b.username,
      (SELECT src FROM users_photos WHERE userId = b.id AND isProfilePic = 1 LIMIT 1) AS profilePicUrl,
      c.authLevel
      FROM content_recommendations a
      LEFT JOIN users b ON a.userId = b.id
      LEFT JOIN users_types c ON b.userType = c.label
      WHERE
      a.rootType = ? AND a.rootId = ? AND a.isDeleted != '1'
      ${contentType === 'pass' && rootType ? `AND a.rootTargetType = ?` : ''}
    `,
    params,
    fromWriter
  );
  results.forEach((result: User) => {
    const userLevelObj = getUserLevelObj(result.achievementPoints);
    result.level = Math.max((result.authLevel || 0) + 1, userLevelObj.level);
  });
  return results;
}

async function questionsQuery(videoId: number) {
  const rows = await poolQuery(
    'SELECT * FROM vq_questions WHERE videoId = ?',
    videoId
  );
  const questions = rows.map((row: any) => ({
    title: row.title,
    choices: [row.choice1, row.choice2, row.choice3, row.choice4, row.choice5],
    correctChoice: row.correctChoice
  }));
  return Promise.resolve(questions);
}

function removeDuplicates(
  array: any[],
  defaults: Record<string, boolean> = {}
) {
  const seen = defaults;
  const result = [];
  for (let i = 0; i < array.length; i++) {
    const {
      videoId
    }: {
      videoId: number;
    } = array[i];
    if (!seen[videoId]) {
      seen[videoId] = true;
      result.push(array[i]);
    }
  }
  return result;
}

async function repliesQuery({
  commentId,
  isLoadingRepliesOfReply,
  includeAll,
  isPreview,
  limit,
  lastReplyId,
  isReverse
}: {
  commentId: number;
  isLoadingRepliesOfReply?: boolean;
  includeAll?: boolean;
  isPreview?: boolean;
  limit?: number;
  lastReplyId?: number;
  isReverse?: boolean;
}) {
  const replies = [];
  let where = '';
  const includeLimitText = !isNaN(Number(limit)) && Number(limit) > 0;
  const lastReplyIdExists = !!(lastReplyId && !isNaN(Number(lastReplyId)));
  if (lastReplyIdExists) {
    where = ` AND id ${isReverse ? '>' : '<'} '${lastReplyId}'`;
  }
  const query1 = `SELECT id FROM content_comments WHERE ${
    isPreview ? `isDeleted != '1' AND ` : ''
  }${isLoadingRepliesOfReply ? 'replyId' : 'commentId'} = ? ${
    includeAll || isLoadingRepliesOfReply ? '' : 'AND replyId = 0'
  }${where} ORDER BY id ${isReverse ? '' : 'DESC'} ${
    includeLimitText ? 'LIMIT ?' : ''
  }`;
  const query2 = `SELECT id FROM content_comments WHERE ${
    isPreview ? `isDeleted != '1' AND ` : ''
  }replyId = ? ${where} ORDER BY id ${isReverse ? '' : 'DESC'} ${
    includeLimitText ? 'LIMIT ?' : ''
  }`;

  const params = [commentId];
  if (includeLimitText) params.push(limit as number);
  let rows = await poolQuery(query1, params);
  if (rows.length === 0) {
    rows = await poolQuery(query2, params);
  }
  if (rows.length === 0) return Promise.resolve([]);
  rows.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
  for (const { id } of rows) {
    const reply = await commentQuery({
      id,
      isLoadingComments: true,
      isPreview,
      exclude: ['targetObj', 'rootObj', 'replies']
    });
    const [{ numReplies = 0 }] = await poolQuery(
      `
        SELECT COUNT(*) AS numReplies FROM content_comments WHERE isDeleted != '1' AND (commentId = ? OR replyId = ?)
      `,
      [id, id]
    );
    replies.push({
      ...reply,
      numComments: Number(numReplies),
      numReplies: Number(numReplies)
    });
  }
  return Promise.resolve(replies);
}

async function reportError({
  user,
  componentPath,
  info,
  message,
  clientVersion
}: {
  user?: User;
  componentPath?: string;
  info?: string;
  message: string;
  clientVersion?: number;
}): Promise<{
  success: boolean;
  status?: {
    error: string;
    message: string;
  };
}> {
  return new Promise((resolve, reject) => {
    const smtpTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: mailAuth
    } as TransportOptions);
    const mailOptions = {
      from: 'twinkle.notification@gmail.com',
      to: 'mikey1384@gmail.com',
      subject: 'Error Report',
      html: `
      ${
        user
          ? `<p>Username: ${user.username}</p><p>User Id: ${user.id}</p>`
          : ''
      }
      ${componentPath ? `<b>Component: ${componentPath}</b>` : ''}
      <p>Error Message: ${message}</p>
      ${info ? `<p>Info: ${info}</p>` : ''}
      <p>Current version: ${currentVersion}</p>
      ${clientVersion ? `<p>Client version: ${clientVersion}</p>` : ''}
    `
    };
    smtpTransport.sendMail(mailOptions, function (error: any) {
      if (error) {
        console.error(error);
        return reject({
          status: 'error',
          msg: 'Email sending failed'
        });
      }
      return resolve({ success: true });
    });
  });
}

async function subjectQuery({
  subjectId,
  isPreview
}: {
  subjectId: number;
  isPreview?: boolean;
}) {
  try {
    const [subject] = await poolQuery(
      `
      SELECT * FROM content_subjects WHERE id = ? AND isDeleted != '1'
    `,
      subjectId
    );
    if (!subject) return Promise.resolve({ notFound: true });
    if (!isPreview && subject.settings) {
      if (subject.settings.mentions) {
        subject.description = await updateMentions({
          mentions: subject.settings.mentions,
          text: subject.description
        });
      }
    }
    let subjectDetails: {
      contentType?: string;
      isClosedBy?: User;
      likes?: any[];
      recommendations?: any[];
      rewards?: any[];
      rootObj?: Content;
      uploader?: User;
    } = {};
    if (!isPreview) {
      subjectDetails = {
        rootObj: subject.rootId
          ? await contentQuery({
              contentType: subject.rootType,
              contentId: subject.rootId
            })
          : {},
        likes: await likesQuery({
          contentType: 'subject',
          contentId: subjectId
        }),
        recommendations: await recommendationsQuery({
          contentType: 'subject',
          contentId: subjectId
        }),
        rewards: await rewardQuery({
          contentType: 'subject',
          contentId: subjectId
        }),
        contentType: 'subject',
        uploader: await userQuery({ userId: subject.userId })
      };
    }
    if (subject?.isClosedBy) {
      subjectDetails.isClosedBy = await userQuery({
        userId: subject.isClosedBy
      });
    }
    return Promise.resolve({
      ...subject,
      ...subjectDetails
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

async function collectRewardedCoins({
  userId,
  userCoins
}: {
  userId: number;
  userCoins: number;
}) {
  try {
    const rewards = await poolQuery(
      `SELECT id, rewardType, rewardAmount FROM users_rewards WHERE userId = ? AND rewardType = 'Twinkle Coin' AND claimed = 0
    `,
      userId,
      true
    );
    if (!rewards?.length) return Promise.resolve(userCoins);
    const ids = rewards.map((reward: { id: number }) => reward.id);
    const totalAmount = rewards.reduce(
      (sum: number, reward: { rewardAmount: number }) =>
        sum + reward.rewardAmount,
      0
    );
    await poolQuery(`UPDATE users_rewards SET claimed = 1 WHERE id IN (?)`, [
      ids
    ]);
    await poolQuery(`INSERT INTO users_coin_change SET ?`, {
      userId,
      type: 'increase',
      action: 'reward',
      amount: totalAmount,
      timeStamp: Math.floor(Date.now() / 1000)
    });
    const increases = await poolQuery(
      `SELECT amount FROM users_coin_change WHERE userId = ? AND type = 'increase'`,
      userId,
      true
    );
    const totalIncrease = increases.reduce(
      (prev: number, { amount = 0 }) => prev + amount,
      0
    );
    const decreases = await poolQuery(
      `SELECT amount FROM users_coin_change WHERE userId = ? AND type = 'decrease'`,
      userId,
      true
    );
    const totalDecrease = decreases.reduce(
      (prev: any, { amount = 0 }) => prev + amount,
      0
    );
    const netCoins = totalIncrease - totalDecrease;
    await poolQuery(`UPDATE users SET ? WHERE id = ?`, [
      { twinkleCoins: netCoins },
      userId
    ]);
    return Promise.resolve(netCoins);
  } catch (error) {
    return Promise.reject(error);
  }
}

async function postMentions({
  mentionsObj,
  rootType,
  rootId,
  userId,
  table,
  previousMentions = [],
  timeStamp
}: {
  mentionsObj: Record<string, { id: number; mentionId: number }>;
  rootType: string;
  rootId: number;
  userId: number;
  table: string;
  previousMentions?: number[];
  timeStamp?: number;
}) {
  if (rootType !== 'chat') {
    for (const [key, mention] of Object.entries(mentionsObj)) {
      if (previousMentions.includes(mention.id)) {
        continue;
      }
      const { insertId: mentionInsertId } = await poolQuery(
        `INSERT INTO noti_mentions SET ? 
          ON DUPLICATE KEY UPDATE 
          rootType = VALUES(rootType), 
          rootId = VALUES(rootId), 
          targetUserId = VALUES(targetUserId), 
          userId = VALUES(userId), 
          timeStamp = VALUES(timeStamp),
          isDeleted = '0'`,
        {
          rootType,
          rootId,
          targetUserId: mention.id,
          userId,
          timeStamp
        }
      );
      mentionsObj[key].mentionId = mentionInsertId;
      if (mention.id !== userId) {
        socket.emit('new_targeted_upload', { targetId: mention.id });
      }
    }
  }
  const settings = JSON.stringify({ mentions: mentionsObj });
  await poolQuery(`UPDATE ${table} SET ? WHERE id = ?`, [
    {
      settings
    },
    rootId
  ]);
}

async function uploadFromStream({
  client,
  folderName,
  path,
  bucketName,
  data
}: {
  client: any;
  folderName: string;
  path: string;
  bucketName: string;
  data: any;
}) {
  const params = {
    Bucket: bucketName,
    Key: `${folderName}/${path}`,
    Body: Readable.from(data)
  };
  try {
    const upload = new Upload({ client, params });
    await upload.done();
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw error;
  }
}

async function updateMentions({
  mentions,
  text
}: {
  mentions: Record<string, any>;
  text: string;
}) {
  const targetText = text || '';

  const updatedMentions: {
    [key: string]: { id: number; currentUsername: string };
  } = {};

  for (const mention in mentions) {
    const userId = mentions[mention]?.id;
    if (!userId) continue;
    const [{ username = '' } = {}] = await poolQuery(
      'SELECT username FROM users WHERE id = ?',
      userId,
      true
    );
    updatedMentions[mention.toLowerCase()] = {
      ...mentions[mention],
      currentUsername: username
    };
  }

  const parts = splitTextByUrls(targetText);

  const processedParts = parts.map((part) => {
    if (part.isUrl) {
      return part.text;
    }
    return part.text.replace(
      /((?!([a-zA-Z1-9])).|^|\n)@[a-zA-Z0-9_]{3,}/gi,
      (match) => {
        const rest = match.split('@')[0];
        const username = match.split('@')[1];
        const userId = updatedMentions[username.toLowerCase()]?.id;
        if (userId) {
          return `${rest}@${
            updatedMentions[username.toLowerCase()].currentUsername
          }`;
        } else {
          return `${rest}＠${username}`;
        }
      }
    );
  });

  return processedParts.join('');

  function splitTextByUrls(text: string) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), isUrl: false });
      }
      parts.push({ text: match[0], isUrl: true });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), isUrl: false });
    }
    return parts;
  }
}

function returnCardBurnXP({
  cardLevel,
  cardQuality
}: {
  cardLevel: number;
  cardQuality: string;
}) {
  // base XP value
  let xp = 50;

  // color probabilities
  const colorProbs: {
    [key: number]: number;
  } = {
    1: 0.5,
    2: 0.2,
    3: 0.15,
    4: 0.1,
    5: 0.05,
    6: 0.05
  };

  // adjust XP based on color
  xp *= 1 / colorProbs[cardLevel] ** 1.281774;

  // quality probabilities
  const qualityProbs: {
    [key: string]: number;
  } = {
    common: 0.5,
    superior: 0.3,
    rare: 0.13,
    elite: 0.05,
    legendary: 0.02
  };

  // adjust XP based on quality
  xp *= 1 / qualityProbs[cardQuality] ** 1.55;

  return Math.round(xp);
}

function calculateTotalBurnValue(cards: Card[]) {
  let totalBv = 0;
  for (const card of cards) {
    if (card.level && card.quality) {
      totalBv += returnCardBurnXP({
        cardLevel: card.level,
        cardQuality: card.quality
      });
    }
  }
  return totalBv;
}

function returnRankings({
  users,
  myId,
  target
}: {
  users: User[];
  myId: number;
  target: string;
}) {
  let myIndex = 0;
  let myRank = null;
  let myScore = 0;
  const rankings: any[] = users.map((currentUser, index) => {
    const rank =
      currentUser[target] > 0
        ? users.filter(
            (user) => Number(user[target]) > Number(currentUser[target])
          ).length + 1
        : null;
    if (currentUser.id === myId) {
      myIndex = index;
      myRank = rank;
      myScore = currentUser[target] || 0;
    }
    return {
      ...currentUser,
      rank
    };
  });
  const all = rankings.filter(
    (ranking, index) =>
      index > Math.max(myIndex - 2, -1) &&
      index < Math.max(myIndex, 3) + 28 &&
      ranking[target] > 0
  );
  const top30s = rankings.filter(
    (ranking, index) => index < 30 && ranking[target] > 0
  );
  return { all, top30s, myIndex, rankings, myRank, myScore };
}

function returnWordLevel({
  frequency,
  word
}: {
  frequency: number;
  word: string;
}) {
  if (!frequency) return 3;
  if (frequency > intermediateWordFrequency) {
    if (word.length < 7) return 1;
    return 2;
  }
  if (word.slice(-2) === 'ly') return 3;
  if (frequency > advancedWordFrequency) return 3;
  if (frequency > epicWordFrequency) return 4;
  if (frequency <= epicWordFrequency) return 5;
  return 3;
}

async function rewardQuery({
  contentType,
  contentId
}: {
  contentType: string;
  contentId: number;
}) {
  const results = await poolQuery(
    `
    SELECT a.id, a.rewardAmount, a.rewarderId,
    b.username AS rewarderUsername, b.achievementPoints, c.src AS rewarderProfilePicUrl, d.authLevel,
    a.rewardComment, a.claimed, a.timeStamp FROM users_rewards a
    JOIN users b ON a.rewarderId = b.id
    LEFT JOIN users_photos c ON a.rewarderId = c.userId AND c.isProfilePic = 1
    LEFT JOIN users_types d ON b.userType = d.label
    WHERE contentType = ? AND contentId = ? ORDER BY id
  `,
    [contentType, contentId]
  );
  results.forEach((result: User) => {
    const userLevelObj = getUserLevelObj(result.achievementPoints);
    result.rewarderLevel = Math.max(
      (result.authLevel || 0) + 1,
      userLevelObj.level
    );
  });
  return results;
}

async function updateUserCoins({
  action,
  type,
  amount,
  userId,
  totalDuration,
  target,
  targetId
}: {
  action: string;
  type: string;
  amount: number;
  userId?: number;
  totalDuration?: number;
  target?: string;
  targetId?: number;
}): Promise<{
  coins?: number;
  alreadyDone?: boolean;
  changeAmount: number;
  direction: 'increase' | 'decrease' | 'none';
}> {
  try {
    if (action === 'attempt' || action === 'collect') {
      const rows = await poolQuery(
        `SELECT id FROM users_coin_change WHERE action = ? AND userId = ? AND target = ? AND targetId = ?`,
        [action, userId, target, targetId],
        true
      );
      if (rows.length > 0)
        return {
          alreadyDone: true,
          changeAmount: 0,
          direction: 'none'
        };
    }
    if (action === 'offer') {
      const rows = await poolQuery(
        `SELECT id FROM users_coin_change WHERE userId = ? AND type = ? AND target = ? AND targetId = ?`,
        [userId, type, target, targetId],
        true
      );
      if (rows.length > 0)
        return {
          alreadyDone: true,
          changeAmount: 0,
          direction: 'none'
        };
    }
    if (action === 'watch' && totalDuration) {
      const [{ duration: userViewDuration = 0 } = {}] = await poolQuery(
        `SELECT duration FROM users_video_view_status WHERE userId = ? AND videoId = ?`,
        [userId, targetId],
        true
      );
      if (
        totalDuration > 180 &&
        Number(userViewDuration) > totalDuration * 1.5
      ) {
        return {
          alreadyDone: true,
          changeAmount: 0,
          direction: 'none'
        };
      }
    }
    if (amount) {
      await poolQuery(`INSERT INTO users_coin_change SET ?`, {
        userId,
        amount,
        type,
        target,
        targetId,
        action,
        timeStamp: Math.floor(Date.now() / 1000)
      });
    }

    const [result] = await poolQuery(
      `SELECT 
        SUM(CASE WHEN type = 'increase' THEN amount ELSE 0 END) AS totalIncrease,
        SUM(CASE WHEN type = 'decrease' THEN amount ELSE 0 END) AS totalDecrease
      FROM 
      users_coin_change 
        WHERE 
        userId = ?`,
      userId,
      true
    );
    const totalIncrease = result.totalIncrease || 0;
    const totalDecrease = result.totalDecrease || 0;
    const netCoins = totalIncrease - totalDecrease;
    await poolQuery(`UPDATE users SET ? WHERE id = ?`, [
      { twinkleCoins: netCoins },
      userId
    ]);
    const direction =
      type === 'increase' || type === 'decrease' ? type : 'none';
    return {
      coins: netCoins,
      changeAmount: amount || 0,
      direction
    };
  } catch (error) {
    console.error('Error updating user coins:', error);
    throw error;
  }
}

async function updateUserXP({
  amount,
  action,
  target,
  targetId,
  totalDuration,
  type,
  userId,
  originalTimeStamp
}: {
  amount: number;
  action: string;
  target: string;
  targetId: number;
  totalDuration?: number;
  type: string;
  userId?: number;
  originalTimeStamp?: number;
}): Promise<{
  xp?: number;
  maxReached?: boolean;
  alreadyDone?: boolean;
  rank?: number;
  newXPRowId?: number;
  changeAmount: number;
  direction: 'increase' | 'decrease' | 'none';
}> {
  let newXPRowId;
  let initialXP = 0;
  try {
    if (userId) {
      const [{ twinkleXP = 0 } = {}] = await poolQuery(
        `SELECT twinkleXP FROM users WHERE id = ?`,
        userId
      );
      initialXP = twinkleXP;
    }
    if (action !== 'collect') {
      if (action === 'register' || action === 'attempt' || action === 'burn') {
        const rows = await poolQuery(
          `SELECT id FROM users_xp_change WHERE userId = ? AND target = ? AND targetId = ?`,
          [userId, target, targetId],
          true
        );
        if (rows.length > 0)
          return {
            alreadyDone: true,
            changeAmount: 0,
            direction: 'none'
          };
      }

      if (action === 'watch') {
        const dailyXPLimit = 50000;
        const todayIndex = getDayIndexAndNextDay().dayIndex;
        const [row] = await poolQuery(
          `SELECT dayIndex, xpEarned FROM users_xp_from_video WHERE userId = ?`,
          [userId, todayIndex],
          true
        );
        if (row) {
          if (row.dayIndex !== todayIndex || row.xpEarned < dailyXPLimit) {
            // If dayIndex is different, reset xpEarned; otherwise, increment it
            const newXpEarned =
              row.dayIndex !== todayIndex ? amount : row.xpEarned + amount;
            await poolQuery(
              `UPDATE users_xp_from_video SET ? WHERE userId = ?`,
              [
                {
                  xpEarned: newXpEarned,
                  dayIndex: todayIndex
                },
                userId
              ]
            );
          } else {
            return {
              maxReached: true,
              changeAmount: 0,
              direction: 'none'
            };
          }
        } else {
          await poolQuery(
            `INSERT INTO users_xp_from_video SET ?`,
            {
              userId,
              dayIndex: todayIndex,
              xpEarned: amount
            },
            true
          );
        }

        if (totalDuration) {
          const [{ duration: userViewDuration = 0 } = {}] = await poolQuery(
            `SELECT duration FROM users_video_view_status WHERE userId = ? AND videoId = ?`,
            [userId, targetId],
            true
          );
          if (
            totalDuration > 180 &&
            Number(userViewDuration) > totalDuration * 1.5
          ) {
            return {
              alreadyDone: true,
              changeAmount: 0,
              direction: 'none'
            };
          }
        }
      }
      if (amount) {
        const { insertId } = await poolQuery(
          `INSERT INTO users_xp_change SET ?`,
          {
            amount,
            userId,
            action,
            target,
            targetId,
            type,
            timeStamp: Math.floor(Date.now() / 1000),
            originalTimeStamp
          }
        );
        newXPRowId = insertId;
      }
    }

    let totalAmount = 0;
    if (action === 'collect') {
      const rewards = await poolQuery(
        `SELECT id, rewardType, rewardAmount FROM users_rewards WHERE userId = ? AND rewardType = 'Twinkle' AND claimed = 0
      `,
        userId,
        true
      );
      for (const { id, rewardType, rewardAmount } of rewards) {
        totalAmount += rewardXps[rewardType] * rewardAmount;
        await poolQuery(
          `UPDATE users_rewards SET claimed = 1 WHERE id = ?`,
          id
        );
      }
      const { insertId } = await poolQuery(
        `INSERT INTO users_xp_change SET ?`,
        {
          userId,
          type: 'increase',
          action: 'reward',
          amount: totalAmount,
          timeStamp: Math.floor(Date.now() / 1000)
        }
      );
      newXPRowId = insertId;
    }
    const increaseQuery = `SELECT amount FROM users_xp_change WHERE userId = ? AND type = 'increase'`;
    const increases = await poolQuery(increaseQuery, userId, true);
    const totalIncrease = increases.reduce(
      (prev: any, { amount = 0 }) => prev + amount,
      0
    );
    const decreaseQuery = `SELECT amount FROM users_xp_change WHERE userId = ? AND type = 'decrease'`;
    const decreases = await poolQuery(decreaseQuery, userId, true);
    const totalDecrease = decreases.reduce(
      (prev: any, { amount = 0 }) => prev + amount,
      0
    );
    const netXP = totalIncrease - totalDecrease;
    const post = { twinkleXP: netXP };
    if (
      userId &&
      initialXP < GOLD_MEMBER_XP_THRESHOLD &&
      netXP >= GOLD_MEMBER_XP_THRESHOLD
    ) {
      await updateAchievementStatus({
        userId,
        type: 'gold'
      });
    }
    await poolQuery(`UPDATE users SET ? WHERE id = ?`, [post, userId]);
    const [{ numHigherXP }] = await poolQuery(
      `SELECT COUNT(*) AS numHigherXP FROM users WHERE twinkleXP > ?`,
      netXP,
      true
    );
    const rank = 1 + Number(numHigherXP);
    const actualAmountChange = action === 'collect' ? totalAmount : amount || 0;
    const direction =
      type === 'increase' || type === 'decrease' ? type : 'none';
    return {
      xp: netXP,
      rank,
      newXPRowId,
      changeAmount: actualAmountChange,
      direction
    };
  } catch (error) {
    console.error('Error updating user XP:', error);
    throw error;
  }
}

async function userQuery({
  userId,
  username,
  isFullLoad = false,
  isFromWriter = false
}: {
  userId?: number;
  username?: string;
  isFullLoad?: boolean;
  isFromWriter?: boolean;
}) {
  if (!userId && !username) {
    return null;
  }
  let rankObject = {};
  try {
    const user: any = {};
    const [row = {}] = await poolQuery(
      `SELECT a.*,
      (SELECT src FROM users_photos WHERE userId = a.id AND isProfilePic = '1') AS profilePicUrl,
      b.authLevel, b.managementLevel, b.canDelete, b.canEdit,
      b.canReward, b.canPinPlaylists, b.canEditPlaylists, b.canEditRewardLevel,
      (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', p.id,
            'src', p.src,
            'caption', p.caption
          )
        )
        FROM (
          SELECT p.*, jt.position
          FROM users_photos p
          INNER JOIN JSON_TABLE(
            a.pictures,
            '$[*]' COLUMNS (
              position FOR ORDINALITY,
              photo_id VARCHAR(255) PATH '$'
            )
          ) AS jt
          WHERE p.id = CAST(jt.photo_id AS UNSIGNED)
          ORDER BY position
        ) p
      ) AS picturesData
      FROM users a
      LEFT JOIN users_types b ON a.userType = b.label
      WHERE ${userId ? 'a.id = ?' : 'a.username = ?'}`,
      userId || username,
      isFromWriter
    );
    for (const key in row) {
      if (key === 'password') continue;
      if (key === 'titleId' && row[key] && isFullLoad) {
        const titleRow = await poolQuery(
          `SELECT title FROM users_titles WHERE id = ?`,
          row[key]
        );
        user.title = titleRow[0]?.title;
      } else if (
        (key === 'profileFirstRow' ||
          key === 'profileSecondRow' ||
          key === 'profileThirdRow' ||
          key === 'statusMsg') &&
        row.settings?.mentions &&
        isFullLoad
      ) {
        user[key] = await updateMentions({
          mentions: row.settings.mentions,
          text: row[key]
        });
      } else if (key === 'picturesData') {
        user.pictures = row[key] || [];
      } else {
        user[key] = row[key];
      }
    }
    const banStatus = user.banned || {};
    const status = user.status || {};
    if (isFullLoad) {
      const hasUsernameChanged = await poolQuery(
        `SELECT EXISTS(SELECT 1 FROM users_username_history WHERE userId = ? LIMIT 1) AS hasChanged`,
        [user.id]
      );
      user.hasUsernameChanged = !!Number(hasUsernameChanged[0]?.hasChanged);
      const achievements = await poolQuery(
        `SELECT * FROM users_achievements_unlocked a JOIN users_achievements b ON a.achievementId = b.id WHERE userId = ?`,
        [user.id]
      );
      const unlockedAchievementIds = achievements.map(
        (achievement: { achievementId: number }) => achievement.achievementId
      );
      user.unlockedAchievementIds = unlockedAchievementIds;
      let calculatedAchievementPoints = 0;
      for (const achievement of achievements) {
        calculatedAchievementPoints += achievement.ap;
      }
      if (calculatedAchievementPoints > user.achievementPoints) {
        await poolQuery(`UPDATE users SET ? WHERE id = ?`, [
          { achievementPoints: calculatedAchievementPoints },
          user.id
        ]);
      }
      const firstDayOfTheMonth =
        Number(moment().startOf('month').format('x')) / 1000;
      const [{ numHigherScorers = 0 } = {}] = await poolQuery(
        `SELECT COUNT(*) AS numHigherScorers FROM users WHERE twinkleXP > ?`,
        user.twinkleXP || 0
      );
      const xps = await poolQuery(
        `SELECT type, amount, originalTimeStamp FROM users_xp_change WHERE userId = ? AND type IS NOT NULL AND timeStamp >= ?`,
        [user.id, firstDayOfTheMonth]
      );
      const xpThisMonth = xps.reduce(
        (
          prev: any,
          {
            amount = 0,
            type,
            originalTimeStamp
          }: {
            amount: number;
            type: string;
            originalTimeStamp: number;
          }
        ) => {
          if (type === 'increase') {
            return prev + amount;
          } else if (type === 'decrease' && originalTimeStamp) {
            if (Number(originalTimeStamp) > Number(firstDayOfTheMonth)) {
              return prev - amount;
            }
          } else {
            return prev;
          }
        },
        0
      );
      rankObject = {
        rank: Number(numHigherScorers) + 1,
        xpThisMonth
      };
    }

    const {
      level = 0,
      canDelete = false,
      canEdit = false,
      canReward = false,
      canPinPlaylists = false,
      canEditPlaylists = false,
      canEditRewardLevel = false,
      managementLevel = 0
    } = getUserLevelObj(user.achievementPoints);
    const finalResult = {
      ...user,
      ...rankObject,
      level: Math.max((user.authLevel || 0) + 1, level),
      canDelete: user.canDelete || canDelete,
      canEdit: user.canEdit || canEdit,
      canReward: user.canReward || canReward,
      canPinPlaylists: user.canPinPlaylists || canPinPlaylists,
      canEditPlaylists: user.canEditPlaylists || canEditPlaylists,
      canEditRewardLevel: user.canEditRewardLevel || canEditRewardLevel,
      managementLevel: Math.max(user.managementLevel, managementLevel),
      banned: banStatus,
      pictures: user.pictures || [],
      status
    };
    return Promise.resolve(finalResult);
  } catch (error) {
    return Promise.reject(error);
  }
}

async function viewsQuery(videoId: number) {
  try {
    const [{ views = 0 } = {}] = await poolQuery(
      `SELECT COUNT(*) AS views FROM vq_video_views WHERE videoId = ?`,
      videoId
    );
    return Number(views);
  } catch (error) {
    return Promise.reject(error);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  aiCardQuery,
  can,
  calculateTotalBurnValue,
  collectRewardedCoins,
  managementLevelQuery,
  numCommentQuery,
  commentQuery,
  contentQuery,
  levels,
  getAge,
  getDayIndexAndNextDay,
  getMonthIndexFromDayIndex,
  getYearFromDayIndex,
  getFileInfoFromFileName,
  getUserLevelObj,
  recommendationsQuery,
  subjectQuery,
  likesQuery,
  objectify,
  processMentions,
  processMentionsOnEdit,
  processAllMentions,
  poolQuery,
  postMentions,
  promiseSeries,
  removeDuplicates,
  repliesQuery,
  reportError,
  rewardQuery,
  returnCardBurnXP,
  returnRankings,
  returnWordLevel,
  updateMentions,
  updateUserXP,
  uploadFromStream,
  questionsQuery,
  sleep,
  updateUserCoins,
  userQuery,
  viewsQuery
};
