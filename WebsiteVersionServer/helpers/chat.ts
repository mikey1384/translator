import { poolQuery, userQuery } from '../helpers';
import { Channel, Message, User } from '../types';
import { chatIdBaseNumber } from '../constants';
import socket from '../constants/socketClient';

export function generateFeedDescription({
  type,
  card,
  summoner,
  offer,
  transfer
}: {
  type: 'summon' | 'offer' | 'transfer';
  card: any;
  summoner?: any;
  offer?: any;
  transfer?: any;
}): string {
  if (type === 'summon') {
    return summoner?.username
      ? `${summoner.username} summoned ${card.name || 'an AI card'}`
      : `An AI card was summoned`;
  }

  if (type === 'offer') {
    const cardOwner = card?.owner?.username
      ? ` (owned by ${card.owner.username})`
      : '';
    const price = Number(offer.price).toLocaleString();
    return `${offer.user?.username || 'Someone'} offered ${price} ${Number(offer.price) === 1 ? 'coin' : 'coins'} for ${card.name || 'an AI card'}${cardOwner}`;
  }

  if (type === 'transfer') {
    const fromUser = transfer.from?.username || 'Someone';
    const toUser = transfer.to?.username || 'someone';

    if (transfer.askId && transfer.ask) {
      const price = Number(transfer.ask.price).toLocaleString();
      return `${toUser} purchased ${card.name || 'an AI card'} from ${fromUser} for ${price} ${Number(transfer.ask.price) === 1 ? 'coin' : 'coins'}`;
    }
    if (transfer.offerId && transfer.offer) {
      const price = Number(transfer.offer.price).toLocaleString();
      return `${fromUser} accepted ${toUser}'s offer of ${price} ${Number(transfer.offer.price) === 1 ? 'coin' : 'coins'} for ${card.name || 'an AI card'}`;
    }
    return `${fromUser} transferred ${card.name || 'an AI card'} to ${toUser}`;
  }

  return '';
}

export async function postDirectMessageChannel({
  user,
  recipientId,
  timeStamp = Math.floor(Date.now() / 1000)
}: {
  user: User;
  recipientId: number;
  timeStamp?: number;
}): Promise<{
  channelId: number;
  timeStamp: number;
  existingChannel?: any;
}> {
  try {
    const [channel] = await poolQuery(
      `SELECT * FROM msg_channels WHERE twoPeople = '1' AND (member1 = ? AND member2 = ?) OR (member1 = ? AND member2 = ?)`,
      [user.id, recipientId, recipientId, user.id],
      true
    );
    if (channel) {
      return Promise.resolve({
        channelId: channel.id,
        existingChannel: channel,
        timeStamp
      });
    }
    const { insertId: channelId } = await poolQuery(
      'INSERT INTO msg_channels SET ?',
      {
        twoPeople: true,
        member1: user.id,
        member2: recipientId
      }
    );
    await updateLastRead({
      users: [{ id: recipientId }, { id: user.id }],
      channelId,
      timeStamp: timeStamp - 1
    });
    await saveChannelMembers(channelId, [user.id, recipientId]);
    await poolQuery('UPDATE users SET ? WHERE id = ?', [
      { lastChannelId: channelId, chatType: null },
      user.id
    ]);
    return Promise.resolve({ channelId, timeStamp });
  } catch (error) {
    return Promise.reject(error);
  }
}

export async function saveChannelMembers(channelId: number, members: number[]) {
  for (const userId of members) {
    await poolQuery('INSERT INTO msg_channel_members SET ?', {
      channelId,
      userId
    });
  }
}

export async function sendSpecialDirectMessage({
  user,
  recipientId,
  channel,
  message,
  channelAlreadyExists
}: {
  user: User;
  recipientId: number;
  channel: Channel;
  message: Message;
  channelAlreadyExists: boolean;
}) {
  const recipient = await userQuery({ userId: recipientId });
  const members = [{ id: user.id, username: user.username }, recipient];
  const pathId = Number(channel.id) + Number(chatIdBaseNumber);

  channelAlreadyExists
    ? socket.emit('new_chat_message', {
        message: {
          ...message,
          userId: user.id,
          username: user.username,
          profilePicUrl: user.profilePicUrl
        },
        channel: { ...channel, pathId, members },
        isNotification: true
      })
    : socket.emit('send_bi_chat_invitation', {
        userId: recipientId,
        message: {
          ...message,
          userId: user.id,
          username: user.username,
          members
        },
        pathId,
        members
      });
  return Promise.resolve({ recipient });
}

export async function updateLastRead({
  users,
  channelId,
  timeStamp
}: {
  users: User[];
  channelId: number;
  timeStamp: number;
}) {
  for (const user of users) {
    // here, we are primarily using Javascript to prevent duplicate insertion and using ON DUPLICATE KEY UPDATE as a backup in order to address the issue described in this link: https://stackoverflow.com/questions/23516958/on-duplicate-key-auto-increment-issue-mysql
    const [{ id = 0 } = {}] = await poolQuery(
      `SELECT id FROM msg_channel_info WHERE channelId = ? AND userId = ?`,
      [channelId, user.id],
      true
    );
    if (id) {
      await poolQuery(`UPDATE msg_channel_info SET ? WHERE id = ?`, [
        { isHidden: false, lastRead: timeStamp },
        id
      ]);
    } else {
      await poolQuery(
        `
          INSERT INTO msg_channel_info (channelId, userId, isHidden, lastRead)
          VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE ?`,
        [
          channelId,
          user.id,
          false,
          timeStamp,
          { isHidden: false, lastRead: timeStamp }
        ]
      );
    }
  }
  return Promise.resolve();
}
export async function updateSubchannelLastRead({
  users,
  subchannelId,
  timeStamp
}: {
  users: User[];
  subchannelId: number;
  timeStamp: number;
}) {
  for (const user of users) {
    // here, we are primarily using Javascript to prevent duplicate insertion and using ON DUPLICATE KEY UPDATE as a backup in order to address the issue described in this link: https://stackoverflow.com/questions/23516958/on-duplicate-key-auto-increment-issue-mysql
    const [{ id = 0 } = {}] = await poolQuery(
      `SELECT id FROM msg_channel_info_sub WHERE channelId = ? AND userId = ?`,
      [subchannelId, user.id],
      true
    );
    if (id) {
      await poolQuery(`UPDATE msg_channel_info_sub SET ? WHERE id = ?`, [
        { lastRead: timeStamp },
        id
      ]);
    } else {
      await poolQuery(
        `
          INSERT INTO msg_channel_info_sub (channelId, userId, lastRead)
          VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ?`,
        [subchannelId, user.id, timeStamp, { lastRead: timeStamp }]
      );
    }
  }
  return Promise.resolve();
}
