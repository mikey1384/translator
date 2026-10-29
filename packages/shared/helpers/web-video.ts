/** Known video links keep the existing fast path; ordinary pages are inspected. */
export function shouldDiscoverWebVideo(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return false;
    if (
      /\.(mp4|m4v|mov|webm|mkv|avi|m3u8|mpd|mp3|m4a|wav|ogg)$/i.test(
        url.pathname
      )
    )
      return false;
    return !/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|vimeo\.com|twitch\.tv|bilibili\.com|b23\.tv|dailymotion\.com|dai\.ly|reddit\.com|redd\.it|streamable\.com)$/i.test(
      url.hostname
    );
  } catch {
    return false;
  }
}
