import { poolQuery, likesQuery } from '../helpers';

async function fetchPlaylists({
  query,
  params = null,
  userId,
  fromWriter
}: {
  query: string;
  params?: any;
  userId?: number;
  fromWriter?: boolean;
}) {
  try {
    const rows = await poolQuery(query, params, fromWriter);
    const playlistIds = rows.map(
      ({ playlistId }: { playlistId: number }) => playlistId
    );
    const playlists = [];
    let watchedVideos = null;
    if (userId) {
      const watchedRows = await poolQuery(
        `SELECT videoId FROM users_video_view_status WHERE userId = ? AND duration > '0'`,
        userId,
        fromWriter
      );
      watchedVideos = watchedRows.map(
        ({ videoId }: { videoId: number }) => videoId
      );
    }
    for (const playlistId of playlistIds) {
      const playlist = await fetchPlaylist({
        playlistId,
        watchedVideos,
        fromWriter
      });
      if (playlist) {
        playlists.push(playlist);
      }
    }
    return Promise.resolve(playlists);
  } catch (error) {
    return Promise.reject(error);
  }
}

async function fetchPlaylist({
  playlistId,
  watchedVideos,
  fromWriter
}: {
  playlistId: number;
  watchedVideos?: number[];
  fromWriter?: boolean;
}) {
  try {
    const playlistVideos = [];
    let rows = await poolQuery(
      `SELECT a.id, a.videoId FROM vq_playlistvideos a JOIN vq_videos b ON a.videoId = b.id WHERE a.playlistId = ? AND b.isDeleted != '1' ORDER BY a.id DESC
    `,
      playlistId,
      fromWriter
    );
    const numVids = rows.length;
    if (numVids === 0) {
      await poolQuery(`DELETE FROM vq_playlists WHERE id = ?`, playlistId);
      await poolQuery(
        `DELETE FROM content_featured_playlists WHERE playlistId = ?`,
        playlistId
      );
      return null;
    }
    if (watchedVideos) {
      const filteredRows = rows.filter(
        (row: { videoId: number }) => !watchedVideos.includes(row.videoId)
      );
      if (filteredRows.length > 4) {
        rows = filteredRows;
      }
    }
    rows = rows.slice(0, 4);
    for (const { id, videoId } of rows) {
      const [video] = await poolQuery(
        `SELECT a.title AS video_title, a.byUser, a.description AS video_description, a.content, a.rewardLevel,
        b.id AS video_uploader_id, b.username AS video_uploader

        FROM vq_videos a JOIN users b ON a.uploader = b.id
        LEFT JOIN content_likes c ON a.id = c.rootId AND c.rootType = 'video' AND c.isDeleted != '1'
        WHERE a.id = ?
      `,
        videoId,
        fromWriter
      );
      playlistVideos.push({
        ...video,
        likes: await likesQuery({ contentType: 'video', contentId: videoId }),
        id,
        videoId
      });
    }
    const [playlistInfo] = await poolQuery(
      `SELECT a.id, a.title, a.creator AS uploaderId, b.username AS uploader
        FROM vq_playlists a LEFT JOIN users b ON a.creator = b.id
        WHERE a.id = ?
      `,
      playlistId,
      fromWriter
    );
    return Promise.resolve({
      ...playlistInfo,
      numPlaylistVids: Number(numVids),
      playlist: playlistVideos,
      showAllButton: numVids > 4
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

export { fetchPlaylists, fetchPlaylist };
