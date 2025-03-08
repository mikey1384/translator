import { poolQuery } from '../helpers';
import {
  postDirectMessageChannel,
  sendSpecialDirectMessage,
  updateLastRead
} from './chat';
import { Channel, User } from '../types';
import socket from '../constants/socketClient';

async function sendManagementMessage({
  user,
  rootType,
  rootId
}: {
  user: User;
  rootType: string;
  rootId: number;
}) {
  const timeStamp = Math.floor(Date.now() / 1000);
  const rows = await poolQuery(
    `SELECT a.id FROM users a JOIN users_types b ON a.userType = b.label WHERE b.managementLevel > 1 AND a.id != ?`,
    user.id
  );
  for (const { id: recipientId } of rows) {
    let channel: Channel = {};
    const { existingChannel, channelId } = await postDirectMessageChannel({
      user,
      recipientId
    });
    if (existingChannel) {
      channel = existingChannel;
    } else {
      channel = {
        id: channelId,
        twoPeople: true,
        channelName: null,
        creator: null,
        lastUpdated: timeStamp,
        member1: user.id,
        member2: recipientId,
        currentSubjectId: null,
        isClosed: false,
        isClass: false
      };
    }
    const message = {
      content: 'took moderator action',
      rootType,
      rootId,
      channelId,
      userId: user.id,
      timeStamp,
      isNotification: true
    };
    const { insertId } = await poolQuery(
      `INSERT INTO msg_chats SET ?`,
      message
    );
    await updateLastRead({
      users: [{ id: user.id }, { id: recipientId }],
      channelId,
      timeStamp: timeStamp - 1
    });
    await sendSpecialDirectMessage({
      user,
      recipientId,
      channel,
      channelAlreadyExists: !!existingChannel,
      message: {
        id: insertId,
        ...message
      }
    });
  }
}

async function revertAchievement({
  userId,
  type
}: {
  userId: number;
  type: string;
}) {
  // Update management_approval_items to pending status
  await poolQuery(
    `UPDATE management_approval_items SET ? WHERE submittedBy = ? AND type = ?`,
    [
      {
        status: 'pending'
      },
      userId,
      type === 'teenager' || type === 'adult' ? 'dob' : type
    ]
  );

  // Special case for 'dob' approval type
  if (type === 'teenager' || type === 'adult') {
    await poolQuery(`UPDATE users SET dob = NULL WHERE id = ?`, userId);
  }

  // Delete achievement from users_achievements_unlocked
  await poolQuery(
    `DELETE FROM users_achievements_unlocked WHERE userId = ? AND achievementId = (SELECT id FROM users_achievements WHERE type = ?)`,
    [userId, type]
  );

  // Delete corresponding notification
  await poolQuery(
    `DELETE FROM noti_feeds WHERE uploaderId = ? AND type = ? AND rootType = ? AND rootId = (SELECT id FROM users_achievements WHERE type = ?)`,
    [userId, 'pass', 'achievement', type]
  );

  const unlockedAchievementRows = await poolQuery(
    `SELECT a.achievementId, b.ap FROM users_achievements_unlocked a JOIN users_achievements b ON a.achievementId = b.id WHERE userId = ?`,
    [userId],
    true
  );

  const achievementPoints = unlockedAchievementRows.reduce(
    (acc: number, row: { ap: number }) => acc + row.ap,
    0
  );

  await poolQuery(
    `UPDATE users SET achievementPoints = ?, titleId = NULL WHERE id = ?`,
    [achievementPoints, userId]
  );

  // Emit socket event
  socket.emit('removed_achievement', {
    userId,
    type
  });
  socket.emit('new_approval_result', {
    type,
    status: 'pending',
    submittedBy: userId
  });
}

export { revertAchievement, sendManagementMessage };
