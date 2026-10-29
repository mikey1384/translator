import { BrowserWindow, session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DownloadFolders } from './private-library.js';
import { parseSrtOriginalOnly } from '../../shared/helpers/index.js';
import { privateMediaRange } from '../../shared/helpers/private-media.js';

const viewers = new Map<string, Set<BrowserWindow>>();
export function closePrivateViewers(folderId: string): void {
  for (const win of viewers.get(folderId) || [])
    if (!win.isDestroyed()) win.destroy();
  viewers.delete(folderId);
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );
function timestamp(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export async function openPrivateViewer(
  folders: DownloadFolders,
  owner: WebContents,
  folderId: string,
  entryId: string,
  labels: { lock: string; privateFolder: string }
): Promise<void> {
  if (owner.isDestroyed()) throw new Error('locked');
  const entry = await folders.entry(owner.id, folderId, entryId);
  if (owner.isDestroyed()) throw new Error('locked');
  if (!entry.ready) throw new Error('pending');
  const video = entry.assets.find(a => a.kind === 'video');
  if (!video) throw new Error('corrupt');
  const capability = randomUUID();
  const origin = `stage5-private://${capability}`;
  const isolated = session.fromPartition(`private-viewer-${randomUUID()}`, {
    cache: false,
  });
  isolated.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith(`${origin}/`) })
  );
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: labels.privateFolder,
    autoHideMenuBar: true,
    backgroundColor: '#101014',
    webPreferences: {
      session: isolated,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  });
  const set = viewers.get(folderId) || new Set<BrowserWindow>();
  set.add(win);
  viewers.set(folderId, set);
  let closed = false;
  let playing = false;
  win.webContents.on('media-started-playing', () => {
    playing = true;
  });
  win.webContents.on('media-paused', () => {
    playing = false;
  });
  const activity = setInterval(() => {
    if (playing) {
      try {
        folders.touch(folderId, owner.id);
      } catch {
        close();
      }
    }
  }, 30_000);
  activity.unref();

  const close = () => {
    if (!win.isDestroyed()) win.destroy();
  };
  owner.once('destroyed', close);
  const activeStreams = new Set<Readable>();
  const captions = entry.assets.filter(a => a.kind === 'subtitle');
  const defaultTrack =
    captions.find(a => a.mime === 'application/x-stage5-subtitle-document')
      ?.id || captions[0]?.id;
  isolated.protocol.handle('stage5-private', async request => {
    try {
      if (
        closed ||
        !['GET', 'HEAD'].includes(request.method) ||
        new URL(request.url).protocol !== 'stage5-private:' ||
        new URL(request.url).hostname !== capability
      )
        return new Response(null, { status: 404 });
      // Also verifies the owner's current unlock lease on every request.
      await folders.entry(owner.id, folderId, entryId);
      const pathname = new URL(request.url).pathname;
      const headers = {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      };
      if (pathname === '/') {
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>${escape(labels.privateFolder)}</title><style>body{margin:0;background:#101014;color:#eee;font:15px system-ui}header{height:54px;display:flex;align-items:center;gap:20px;padding:0 20px}header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}a{color:#ffe36b;text-decoration:none;padding:8px 16px;border:1px solid #555;border-radius:8px}video{display:block;width:100%;height:calc(100vh - 54px);background:#000}video::cue{color:white;background:rgba(0,0,0,.72)}</style></head><body><header><span>${escape(entry.item.title)}</span><a href="stage5-private-action://lock" target="_blank" rel="noreferrer">${escape(labels.lock)}</a></header><video controls autoplay disableRemotePlayback controlsList="nodownload noremoteplayback" src="${origin}/media/${video.id}">${captions.map((a, i) => `<track kind="subtitles" label="${escape(a.label || String(i + 1))}" src="${origin}/captions/${a.id}" ${a.id === defaultTrack ? 'default' : ''}>`).join('')}</video></body></html>`;
        return new Response(html, {
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      const [, kind, id] = pathname.split('/');
      const asset = entry.assets.find(a => a.id === id);
      if (
        !asset ||
        !['media', 'captions'].includes(kind) ||
        (kind === 'media' && asset.kind !== 'video') ||
        (kind === 'captions' && asset.kind !== 'subtitle')
      )
        return new Response(null, { status: 404 });
      if (kind === 'captions') {
        if (asset.size > 8 * 1024 ** 2)
          return new Response(null, { status: 413 });
        const { stream } = await folders.media(owner.id, folderId, entryId, id);
        const parts: Buffer[] = [];
        for await (const part of stream) parts.push(part);
        const bytes = Buffer.concat(parts);
        const cues =
          asset.mime === 'application/x-stage5-subtitle-document'
            ? JSON.parse(bytes.toString('utf8')).segments.map(
                (cue: {
                  start: number;
                  end: number;
                  original: string;
                  translation?: string;
                }) => ({ ...cue, original: cue.translation || cue.original })
              )
            : parseSrtOriginalOnly(bytes.toString('utf8'));
        bytes.fill(0);
        for (const part of parts) part.fill(0);
        const vtt =
          'WEBVTT\n\n' +
          cues
            .map(
              (c: { start: number; end: number; original: string }) =>
                `${timestamp(c.start)} --> ${timestamp(c.end)}\n${c.original.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r/g, '')}\n`
            )
            .join('\n');
        return new Response(vtt, {
          headers: { ...headers, 'Content-Type': 'text/vtt; charset=utf-8' },
        });
      }
      const range = privateMediaRange(request.headers.get('range'), asset.size);
      if (!range)
        return new Response(null, {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${asset.size}` },
        });
      const media = await folders.media(
        owner.id,
        folderId,
        entryId,
        id,
        range.start,
        range.end
      );
      const source = Readable.from(media.stream);
      activeStreams.add(source);
      const abort = () => source.destroy();
      media.signal.addEventListener('abort', abort, { once: true });
      request.signal.addEventListener('abort', abort, { once: true });
      source.once('close', () => {
        activeStreams.delete(source);
        media.signal.removeEventListener('abort', abort);
        request.signal.removeEventListener('abort', abort);
      });
      if (request.method === 'HEAD') source.destroy();
      return new Response(
        request.method === 'HEAD'
          ? null
          : (Readable.toWeb(source) as ReadableStream<Uint8Array>),
        {
          status: range.partial ? 206 : 200,
          headers: {
            ...headers,
            'Content-Type': media.mime,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(range.end - range.start + 1),
            ...(range.partial
              ? {
                  'Content-Range': `bytes ${range.start}-${range.end}/${asset.size}`,
                }
              : {}),
          },
        }
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'stage5-private-action://lock') folders.lock(folderId);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== `${origin}/`) event.preventDefault();
  });
  win.on('closed', () => {
    closed = true;
    clearInterval(activity);
    owner.removeListener('destroyed', close);
    for (const source of activeStreams) source.destroy();
    set.delete(win);
    if (!set.size) viewers.delete(folderId);
    isolated.protocol.unhandle('stage5-private');
    void isolated.clearStorageData().catch(() => {});
  });
  try {
    await win.loadURL(`${origin}/`);
    folders.touch(folderId, owner.id);
    if (owner.isDestroyed()) throw new Error('locked');
    if (!win.isDestroyed()) win.show();
  } catch (error) {
    close();
    throw error;
  }
}
