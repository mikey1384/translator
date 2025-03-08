import socket from '../constants/socketClient';
import {
  getUserLevelObj,
  poolQuery,
  userQuery,
  updateUserCoins,
  getAge
} from '../helpers';
import {
  defaultTitle,
  idToAchievementType,
  priceTable,
  GRAMMAR_TYCOON_COIN_THRESHOLD,
  GOLD_MEMBER_XP_THRESHOLD,
  ADULT_AGE,
  TEENAGER_AGE,
  TEACHER_LEVEL
} from '../constants';
import { v1 as uuidv1 } from 'uuid';
import { User } from '../types';

export function isSupermod(level = 0) {
  return level >= TEACHER_LEVEL;
}

interface Achievement {
  type: string;
  isUnlocked: boolean;
  milestones?: any[]; // Adjust the type as needed
  progressObj?: {
    label: string;
    currentValue: number;
    targetValue: number;
  };
}
export async function loadUserAchievements(userId: number): Promise<{
  mission?: Achievement;
  teenager?: Achievement;
  adult?: Achievement;
  summoner?: Achievement;
  grammar?: Achievement;
  gold?: Achievement;
  [key: string]: Achievement | undefined;
}> {
  if (!userId || isNaN(userId)) return Promise.resolve({});
  const user = await userQuery({ userId });
  const unlockedAchievements: Record<string, boolean> = {};
  const unlockedAchievementsRows = await poolQuery(
    `SELECT b.type FROM users_achievements_unlocked a JOIN users_achievements b ON a.achievementId = b.id WHERE a.userId = ?`,
    userId
  );
  for (const { type } of unlockedAchievementsRows) {
    unlockedAchievements[type] = true;
  }
  const achievements = await poolQuery(
    'SELECT * FROM users_achievements ORDER BY orderNumber'
  );
  const result: Record<string, any> = {};
  for (const achievement of achievements) {
    let milestones = null;
    let progressObj = null;
    switch (achievement.type) {
      case 'mission': {
        if (!unlockedAchievements.mission) {
          const attemptedMissions = await loadMissionStatus({ userId });
          const sortedMissions = attemptedMissions
            .map((mission, index) => ({
              index,
              name: mission.name,
              completed: mission.status === 'pass'
            }))
            .sort((a, b) =>
              a.completed === b.completed
                ? a.index - b.index
                : a.completed
                  ? -1
                  : 1
            );
          milestones = sortedMissions;
          if (sortedMissions.every((mission) => mission.completed)) {
            await updateAchievementStatus({
              userId: userId,
              type: 'mission'
            });
          }
        }
        break;
      }
      case 'teenager':
      case 'adult': {
        const requiredAge =
          achievement.type === 'teenager' ? TEENAGER_AGE : ADULT_AGE;
        let userAge = 0;
        if (user.dob) {
          userAge = getAge(user.dob);
        }
        const userIsOfAge = user.dob && userAge >= requiredAge;
        if (userIsOfAge && !unlockedAchievements[achievement.type]) {
          await updateAchievementStatus({
            userId: userId,
            type: achievement.type
          });
        }
        break;
      }
      case 'summoner': {
        if (user.canGenerateAICard && !unlockedAchievements.summoner) {
          await updateAchievementStatus({
            userId: userId,
            type: 'summoner'
          });
        }
        break;
      }
      case 'grammar': {
        if (!unlockedAchievements.grammar) {
          const [{ coinEarnedTotal = 0 } = {}] = await poolQuery(
            `SELECT coinEarnedTotal FROM game_grammar_stats WHERE userId = ?`,
            [userId],
            true
          );
          progressObj = {
            label: 'Coins earned',
            currentValue: coinEarnedTotal,
            targetValue: GRAMMAR_TYCOON_COIN_THRESHOLD
          };
          if (coinEarnedTotal >= GRAMMAR_TYCOON_COIN_THRESHOLD) {
            await updateAchievementStatus({
              userId: userId,
              type: 'grammar'
            });
          }
        }
        break;
      }
      case 'gold': {
        if (!unlockedAchievements.gold) {
          const [{ twinkleXP }] = await poolQuery(
            `SELECT twinkleXP FROM users WHERE id = ?`,
            [userId],
            true
          );
          progressObj = {
            label: 'XP earned',
            currentValue: twinkleXP,
            targetValue: GOLD_MEMBER_XP_THRESHOLD
          };
          if (twinkleXP > GOLD_MEMBER_XP_THRESHOLD) {
            await updateAchievementStatus({
              userId: userId,
              type: 'gold'
            });
          }
        }
        break;
      }
      default:
        break;
    }
    result[achievement.type] = {
      ...achievement,
      isUnlocked: !!unlockedAchievements[achievement.type],
      milestones,
      progressObj
    };
  }
  return result;
}

export async function loadMissionStatus({
  userId,
  fromWriter = false
}: {
  userId?: number;
  fromWriter?: boolean;
}) {
  if (!userId || isNaN(userId)) {
    return Promise.resolve([]);
  }
  try {
    const missions = await poolQuery(
      `SELECT id, title, missionType, orderNumber, isTask, rootMissionId FROM content_missions ORDER BY orderNumber`
    );
    const attempts = await poolQuery(
      `SELECT * FROM content_mission_attempts WHERE userId = ? AND status = 'pass'`,
      userId,
      fromWriter
    );
    const missionObj: {
      [key: string]: {
        key: string;
        name: string;
        status?: string;
      };
    } = {};
    const missionOrder = [];
    const multiMissionObj: {
      [key: string]: string[];
    } = {};
    for (const mission of missions) {
      if (mission.orderNumber) {
        missionOrder.push(mission.id);
      }
      if (mission.isTask) {
        if (multiMissionObj[mission.rootMissionId]) {
          multiMissionObj[mission.rootMissionId].push(mission.id);
        } else {
          multiMissionObj[mission.rootMissionId] = [mission.id];
        }
      }
      missionObj[mission.id] = {
        key: mission.missionType,
        name: mission.title
      };
    }
    for (const attempt of attempts) {
      missionObj[attempt.missionId].status = attempt.status;
    }
    const result = missionOrder.map((id) => {
      if (multiMissionObj[id]) {
        const totalNumTasks = multiMissionObj[id].length;
        const passedTasks = multiMissionObj[id].filter(
          (id) => missionObj[id].status === 'pass'
        );
        const numPassedTasks = passedTasks.length;
        return {
          ...missionObj[id],
          taskProgress: `${numPassedTasks}/${totalNumTasks}`,
          ...(totalNumTasks === numPassedTasks ? { status: 'pass' } : {})
        };
      }
      return missionObj[id];
    });
    let allMissionsCompleted = true;
    for (const [, value] of Object.entries(result)) {
      if (value.status !== 'pass') {
        allMissionsCompleted = false;
        break;
      }
    }
    if (allMissionsCompleted) {
      await updateAchievementStatus({
        userId,
        type: 'mission'
      });
    }
    return Promise.resolve(result);
  } catch (error) {
    return Promise.reject(error);
  }
}

export async function updateAchievementStatus({
  userId,
  type
}: {
  userId: number;
  type: string;
}) {
  const timeStamp = Math.floor(Date.now() / 1000);
  const appliedTitle = defaultTitle[type];
  if (appliedTitle) {
    await poolQuery(
      `UPDATE users SET titleId = (SELECT id FROM users_titles WHERE title = ?) WHERE id = ?`,
      [appliedTitle, userId]
    );
  }

  try {
    const rows = await poolQuery(
      `SELECT * FROM users_achievements_unlocked WHERE achievementId = ? AND userId = ?`,
      [idToAchievementType[type], userId],
      true
    );
    if (!rows.length) {
      const { insertId } = await poolQuery(
        `INSERT INTO users_achievements_unlocked (userId, achievementId, timeStamp)
          VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ?`,
        [
          userId,
          idToAchievementType[type],
          Math.floor(Date.now() / 1000),
          { timeStamp }
        ]
      );
      await poolQuery(
        `INSERT INTO noti_feeds 
          SET ? 
          ON DUPLICATE KEY UPDATE 
            timeStamp = VALUES(timeStamp),
            lastInteraction = VALUES(lastInteraction)
        `,
        {
          type: 'pass',
          contentId: insertId,
          rootType: 'achievement',
          rootId: idToAchievementType[type],
          uploaderId: userId,
          timeStamp,
          lastInteraction: timeStamp
        }
      );
      await updateAchievementPoints(userId);
      socket.emit('new_achievement', {
        userId,
        type
      });
    }
  } catch (error) {
    console.error(error);
    return Promise.reject(error);
  }
}

export async function updateAchievementPoints(userId: number) {
  try {
    const achievements: Record<string, any> =
      await loadUserAchievements(userId);
    let achievementPoints = 0;
    for (const key in achievements) {
      if (achievements[key].isUnlocked) {
        achievementPoints += achievements[key].ap;
      }
    }
    await poolQuery(`UPDATE users SET achievementPoints = ? WHERE id = ?`, [
      achievementPoints,
      userId
    ]);
    return Promise.resolve(achievementPoints);
  } catch (error) {
    console.error(error);
    return Promise.reject(error);
  }
}

export async function rewardUser({
  user,
  amount,
  contentId,
  contentType,
  rewardType,
  rewardExplanation,
  rootType,
  rootId,
  uploaderId
}: {
  user: User;
  amount: number;
  contentId: number;
  contentType: string;
  rewardType: string;
  rewardExplanation?: string;
  rootType: string;
  rootId: number;
  uploaderId: number;
}): Promise<{
  alreadyRewarded?: boolean;
  netCoins?: number;
  reward?: any;
}> {
  let netCoins = user.twinkleCoins;
  const [{ achievementPoints = 0, authLevel = 0 } = {}] = await poolQuery(
    `
      SELECT a.achievementPoints, b.authLevel, b.id, b.label
      FROM users a JOIN users_types b ON a.userType = b.label
      WHERE a.id = ?  
    `,
    uploaderId,
    true
  );
  const uploaderUserLevelObj = getUserLevelObj(achievementPoints);
  const uploaderLevel = Math.max(authLevel + 1, uploaderUserLevelObj.level);
  const userLevel = Math.max((user.authLevel || 0) + 1, user.level || 0);
  const isRewardingTwinkleToAnotherMod =
    rewardType === 'Twinkle' && uploaderLevel >= userLevel;
  const requiresPayment =
    !userLevel || !isSupermod(userLevel) || isRewardingTwinkleToAnotherMod;
  if (requiresPayment && amount > (netCoins || 0)) {
    return Promise.resolve({ netCoins });
  }

  if (contentType === 'recommendation' && rewardType === 'Twinkle Coin') {
    const rows = await poolQuery(
      `SELECT id FROM users_rewards WHERE contentType = ? AND contentId = ? AND userId = ? LIMIT 1`,
      [contentType, contentId, uploaderId],
      true
    );
    if (rows.length > 0) {
      return Promise.resolve({ alreadyRewarded: true });
    }
  }
  try {
    const post = {
      contentId,
      contentType,
      rootType,
      rootId,
      userId: uploaderId,
      rewarderId: user.id,
      rewardComment: rewardExplanation,
      rewardType,
      rewardAmount: amount,
      timeStamp: Math.floor(Date.now() / 1000)
    };
    const { insertId } = await poolQuery(
      `INSERT INTO users_rewards SET ?`,
      post
    );

    const reward = {
      ...post,
      id: insertId,
      rewarderUsername: user.username,
      rewarderProfilePicUrl: user.profilePicUrl
    };
    socket.emit('new_reward', {
      targetId: uploaderId,
      target: { contentId, contentType },
      reward
    });
    if (requiresPayment) {
      const { coins } = await updateUserCoins({
        action: 'reward',
        type: 'decrease',
        userId: user.id,
        amount: amount * priceTable.reward,
        target: 'user',
        targetId: uploaderId
      });
      netCoins = coins;
    }
    return Promise.resolve({ reward, netCoins });
  } catch (error) {
    return Promise.reject(error);
  }
}

export async function rewardUsersForRecommending({
  user,
  rootType,
  rootId,
  rootTargetType,
  recommendations
}: {
  user: User;
  rootType: string;
  rootId: number;
  rootTargetType?: string;
  recommendations: { recommendationId: number; recommenderId: number }[];
}) {
  try {
    const selects = recommendations
      .map(({ recommendationId, recommenderId }) => {
        return `SELECT * FROM (SELECT ${recommendationId} AS contentId, 'recommendation' AS contentType, '${rootType}' AS rootType, ${rootId} AS rootId, ${recommenderId} AS userId, ${
          user.id
        } AS rewarderId, 'Twinkle Coin' AS rewardType, ${
          priceTable.recommendation * 3
        } AS rewardAmount, ${Math.floor(Date.now() / 1000)} AS timeStamp${
          rootTargetType ? `, '${rootTargetType}' AS rootTargetType` : ''
        } FROM DUAL) AS tmp`;
      })
      .join(' UNION ALL ');

    await poolQuery(`
      INSERT INTO users_rewards (contentId, contentType, rootType, rootId, userId, rewarderId, rewardType, rewardAmount, timeStamp${
        rootTargetType ? `, rootTargetType` : ''
      })
      ${selects}
      WHERE NOT EXISTS (
        SELECT 1 FROM users_rewards 
        WHERE contentType = 'recommendation' 
        AND contentId = tmp.contentId 
        AND userId = tmp.userId
        ${rootTargetType ? 'AND rootTargetType = tmp.rootTargetType' : ''}
      )
    `);
    recommendations.forEach((recommendation) => {
      const reward = {
        id: uuidv1(),
        contentId: recommendation.recommendationId,
        contentType: 'recommendation',
        rootType: rootType,
        rootId: rootId,
        userId: recommendation.recommenderId,
        rewarderId: user.id,
        rewardType: 'Twinkle Coin',
        rewardAmount: priceTable.recommendation * 3,
        timeStamp: Math.floor(Date.now() / 1000),
        ...(rootTargetType ? { rootTargetType: rootTargetType } : {}),
        rewarderUsername: user.username,
        rewarderProfilePicUrl: user.profilePicUrl
      };
      socket.emit('new_reward', {
        targetId: recommendation.recommenderId,
        target: {
          contentId: recommendation.recommendationId,
          contentType: 'recommendation'
        },
        reward
      });
    });

    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}
