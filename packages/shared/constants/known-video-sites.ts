/**
 * Well-known public video sites. A job's "source site" is recorded only as
 * one of these names, or as 'other': a host that is not on this list
 * (a private server, a company intranet, a personal domain, or any site
 * someone might not want named) is never stored or sent.
 *
 * CANONICAL COPY: stage5-api/src/shared/known-video-sites.ts
 * Copy:           translator/packages/shared/constants/known-video-sites.ts   <- this file
 * A stage5-api test compares the two; add a site to both.
 */
export const KNOWN_VIDEO_SITES = [
  'youtube.com',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'vimeo.com',
  'dailymotion.com',
  'twitch.tv',
  'reddit.com',
  'bilibili.com',
  'bilibili.tv',
  'nicovideo.jp',
  'naver.com',
  'kakao.com',
  'sooplive.co.kr',
  'douyin.com',
  'weibo.com',
  'youku.com',
  'iqiyi.com',
  'ixigua.com',
  'kuaishou.com',
  'xiaohongshu.com',
  'zhihu.com',
  'vk.com',
  'ok.ru',
  'rutube.ru',
  'rumble.com',
  'odysee.com',
  'bitchute.com',
  'kick.com',
  'streamable.com',
  'loom.com',
  'soundcloud.com',
  'ted.com',
  'archive.org',
  'linkedin.com',
  'pinterest.com',
  'tumblr.com',
  'threads.com',
  'bsky.app',
  'telegram.org',
  'imgur.com',
  '9gag.com',
  'dropbox.com',
  'google.com',
  'udemy.com',
  'coursera.org',
  'crunchyroll.com',
  'viki.com',
  'wetv.vip',
  'abema.tv',
  'tver.jp',
  'nhk.or.jp',
  'bbc.co.uk',
  'bbc.com',
  'cnn.com',
  'nytimes.com',
  'espn.com',
] as const;

export const OTHER_VIDEO_SITE = 'other';

export type KnownVideoSite =
  | (typeof KNOWN_VIDEO_SITES)[number]
  | typeof OTHER_VIDEO_SITE;

/** Short-link and renamed hosts that belong to a listed site. */
export const VIDEO_SITE_ALIASES: Record<string, KnownVideoSite> = {
  'youtu.be': 'youtube.com',
  'youtube-nocookie.com': 'youtube.com',
  'twitter.com': 'x.com',
  't.co': 'x.com',
  'fb.watch': 'facebook.com',
  'fb.com': 'facebook.com',
  'redd.it': 'reddit.com',
  'threads.net': 'threads.com',
  't.me': 'telegram.org',
  'b23.tv': 'bilibili.com',
  'nico.ms': 'nicovideo.jp',
  'afreecatv.com': 'sooplive.co.kr',
  'vkvideo.ru': 'vk.com',
  'vk.ru': 'vk.com',
  'dai.ly': 'dailymotion.com',
  'pin.it': 'pinterest.com',
  'instagr.am': 'instagram.com',
};
