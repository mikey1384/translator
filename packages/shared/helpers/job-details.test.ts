import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanJobDetails, siteNameFromUrl } from './job-details.js';

test('a well-known video site is named, whatever the address looks like', () => {
  const cases: Array<[string, string]> = [
    ['https://www.youtube.com/watch?v=abc123&list=xyz', 'youtube.com'],
    ['https://m.youtube.com/watch?v=a', 'youtube.com'],
    ['https://music.youtube.com/watch?v=a', 'youtube.com'],
    ['https://youtu.be/abc123', 'youtube.com'],
    ['https://twitter.com/user/status/1', 'x.com'],
    ['https://user:secret@Vimeo.com:443/12345#t=10', 'vimeo.com'],
    ['https://tv.naver.com/v/1', 'naver.com'],
    ['https://www.bbc.co.uk/iplayer/episode/x', 'bbc.co.uk'],
    ['https://vm.tiktok.com/abc/', 'tiktok.com'],
    ['https://YOUTUBE.COM./watch?v=a', 'youtube.com'],
  ];
  for (const [url, site] of cases)
    assert.equal(siteNameFromUrl(url), site, url);
});

test('every other web address is only "other", never its host name', () => {
  for (const url of [
    'https://jira.acme-corp.internal/x',
    'http://nas.local/v.mp4',
    'https://plex.tail1234.ts.net/v',
    'https://acme.sharepoint.com/sites/hr/video.mp4',
    'https://my-private-bucket.s3.amazonaws.com/a.mp4',
    'http://10.0.0.1.nip.io/v',
    'https://johnsmith-family-videos.com/2024/birthday',
    'https://video.example.co.uk/a/b?token=1',
    'https://한국어.kr/video',
    'http://localhost:3000/video.mp4',
    'http://192.168.0.10/video.mp4',
    'http://[::1]/video.mp4',
    'https://notyoutube.com/watch',
    'https://youtube.com.evil.example/watch',
  ]) {
    assert.equal(siteNameFromUrl(url), 'other', url);
  }
});

test('local files and non-web addresses give no site', () => {
  for (const url of [
    null,
    undefined,
    '',
    '/Users/a/Movies/clip.mp4',
    'file:///Users/a/Movies/clip.mp4',
    'ftp://example.com/video.mp4',
    'not a url',
  ]) {
    assert.equal(siteNameFromUrl(url), undefined, String(url));
  }
});

test('only the four well-formed fields survive cleaning', () => {
  assert.deepEqual(
    cleanJobDetails({
      sourceLanguage: 'EN',
      targetLanguage: 'chinese_simplified',
      videoSeconds: 3599.6,
      sourceSite: 'YouTube.com',
      title: 'My holiday',
    } as any),
    {
      sourceLanguage: 'en',
      targetLanguage: 'chinese_simplified',
      videoSeconds: 3600,
      sourceSite: 'youtube.com',
    }
  );
});

test('"original" and other non-languages are not reported as a language', () => {
  assert.deepEqual(
    cleanJobDetails({ targetLanguage: 'original', videoSeconds: 60 }),
    { videoSeconds: 60 }
  );
  assert.equal(cleanJobDetails({ sourceLanguage: 'auto' }), null);
});

test('bad values are dropped and empty input gives nothing', () => {
  assert.deepEqual(
    cleanJobDetails({
      sourceLanguage: 'two words',
      targetLanguage: 'korean',
      videoSeconds: 0,
      sourceSite: 'https://youtube.com/watch?v=abc',
    }),
    { targetLanguage: 'korean' }
  );
  assert.equal(
    cleanJobDetails({ sourceSite: 'jira.acme-corp.internal' }),
    null
  );
  assert.equal(
    cleanJobDetails({ targetLanguage: 'my-secret-video-title' }),
    null
  );
  assert.deepEqual(cleanJobDetails({ sourceSite: 'other' }), {
    sourceSite: 'other',
  });
  assert.equal(cleanJobDetails(null), null);
  assert.equal(cleanJobDetails({}), null);
  assert.equal(cleanJobDetails({ videoSeconds: Number.NaN }), null);
});
