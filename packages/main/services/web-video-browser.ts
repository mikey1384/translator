import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DiscoverWebVideoOptions } from '@shared-types/app';
import { CancelledError } from '../../shared/cancelled-error.js';
import { webSessionForUrl } from './url-processor/site-cookies.js';
import {
  manifestFailureOutcome,
  type WebVideoDiagnostics,
} from './web-video-diagnostics.js';
import { webVideoManifestRequest } from './web-video-request.js';
import {
  safeWebVideoUrl,
  webVideoId,
  type WebVideoSource,
  type WebVideoBrowserLease,
  inspectWebVideoManifest,
} from './web-video-model.js';

const busySessions = new Set<Electron.Session>();
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );

/** Remote content never gets a preload or access to Translator's IPC bridge. */
export async function discoverVideosInBrowser(options: {
  url: string;
  owner: WebContents;
  signal: AbortSignal;
  labels: DiscoverWebVideoOptions['labels'];
  fixtureOrigin?: string;
  diagnostics: WebVideoDiagnostics;
  onCancel: () => void;
}): Promise<WebVideoSource[]> {
  const { url, owner, signal, labels, fixtureOrigin, diagnostics } = options;
  if (signal.aborted || owner.isDestroyed()) throw new CancelledError();
  const siteSession = webSessionForUrl(url);
  if (busySessions.has(siteSession))
    throw new Error('A video page is already open for this site.');
  const win = new BrowserWindow({
    width: 1060,
    height: 800,
    minWidth: 640,
    minHeight: 450,
    show: false,
    title: labels.title,
    autoHideMenuBar: true,
    backgroundColor: '#101014',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: `web-video-toolbar-${randomUUID()}`,
    },
  });
  const view = new WebContentsView({
    webPreferences: {
      session: siteSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const wc = view.webContents;
  let pickerOpen = false;
  busySessions.add(siteSession);
  win.contentView.addChildView(view);
  const layout = () => {
    const [width, height] = win.getContentSize();
    const top = pickerOpen ? Math.min(330, Math.floor(height / 2)) : 90;
    view.setBounds({ x: 0, y: top, width, height: Math.max(1, height - top) });
    if (!win.webContents.isLoadingMainFrame())
      void win.webContents
        .executeJavaScript(
          `document.getElementById('videos').style.height=${JSON.stringify(`${top - 90}px`)}`
        )
        .catch(() => {});
  };
  layout();
  win.on('resize', layout);
  siteSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  siteSession.setPermissionCheckHandler(() => false);
  const sources = new Map<string, WebVideoSource>();
  const childManifests = new Set<string>();
  const checkedManifests = new Map<
    string,
    {
      pending: Promise<boolean>;
      attempts: number;
      started: number;
      settled: boolean;
      usable: boolean;
    }
  >();
  const observedBlobs = new Set<string>();
  const abortRequests = new AbortController();
  let protectedVideo = false;
  let liveVideo = false;
  let currentPage = url;
  let pageGeneration = 0;
  let finished = false;
  let selected: WebVideoSource | undefined;
  let scanning = false;
  let nextFrame = 0;
  let frameCount = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let finish: (chosen?: WebVideoSource) => void = () => {};
  let closeBrowser: (
    outcome: 'ok' | 'cancelled' | 'released'
  ) => void = () => {};
  const browser: WebVideoBrowserLease = {
    cancelled: false,
    close: reason => {
      if (finished) return;
      if (reason === 'transfer_started') diagnostics('transfer_started');
      closeBrowser(reason === 'transfer_started' ? 'ok' : 'released');
    },
  };
  const refresh = () => {
    if (win.isDestroyed()) return;
    const count = sources.size;
    const rows = [...sources.values()]
      .map(({ candidate }, index) => {
        const seconds = Math.floor(candidate.durationSec || 0);
        const duration =
          seconds > 0
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : '';
        const detail = [
          duration,
          candidate.height ? `${candidate.height}p` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<a class="video" target="_blank" href="stage5-web-video:select/${candidate.id}"><span class="number">${index + 1}</span><section><strong>${escapeHtml(candidate.title)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</section></a>`;
      })
      .join('');
    void win.webContents
      .executeJavaScript(
        `(()=>{const a=document.getElementById('choose');a.textContent=${JSON.stringify(`${labels.choose}${count ? ` (${count})` : ''}`)};a.setAttribute('aria-disabled',${JSON.stringify(String(count === 0 || Boolean(selected)))});a.setAttribute('aria-expanded',${JSON.stringify(String(pickerOpen))});a.style.pointerEvents=${JSON.stringify(count && !selected ? 'auto' : 'none')};a.style.opacity=${JSON.stringify(count && !selected ? '1' : '.45')};document.getElementById('host').textContent=${JSON.stringify(new URL(currentPage).hostname)};document.getElementById('hint').textContent=${JSON.stringify(selected ? labels.starting || labels.instruction : !count && protectedVideo ? labels.protected : !count && liveVideo ? labels.live : labels.instruction)};const list=document.getElementById('videos');const rows=${JSON.stringify(rows)};if(list.innerHTML!==rows)list.innerHTML=rows;list.hidden=${JSON.stringify(!pickerOpen)}})()`
      )
      .catch(() => {});
  };
  const add = (
    raw: string,
    detail: Partial<WebVideoSource['candidate']> = {},
    referer = currentPage
  ) => {
    if (finished || selected) return;
    const media = safeWebVideoUrl(raw, referer, fixtureOrigin);
    if (!media || childManifests.has(media) || sources.size >= 20) return;
    const existing = sources.get(media);
    const candidate = {
      id: webVideoId(`${url}\n${media}`),
      title: wc.getTitle().slice(0, 240) || new URL(currentPage).hostname,
      ...existing?.candidate,
      ...Object.fromEntries(
        Object.entries(detail).filter(([, v]) => v !== undefined)
      ),
    };
    sources.set(media, {
      candidate,
      url: media,
      referer,
      userAgent: wc.getUserAgent(),
    });
    if (!existing) diagnostics('candidate_added', { count: sources.size });
    refresh();
  };
  const inspectManifest = (
    media: string,
    referer: string,
    ancestors: string[] = []
  ): Promise<boolean> => {
    if (ancestors.includes(media) || ancestors.length > 2)
      return Promise.resolve(false);
    const existing = checkedManifests.get(media);
    if (
      existing &&
      (!existing.settled ||
        existing.usable ||
        existing.attempts >= 3 ||
        Date.now() - existing.started < 1500)
    )
      return existing.pending;
    if (!existing && checkedManifests.size >= 30) return Promise.resolve(false);
    const check = {
      pending: Promise.resolve(false),
      attempts: (existing?.attempts || 0) + 1,
      started: Date.now(),
      settled: false,
      usable: false,
    };
    const generation = pageGeneration;
    diagnostics('manifest_observed', { attempt: check.attempts });
    const pending = (async () => {
      try {
        const response = await siteSession.fetch(media, {
          ...webVideoManifestRequest(media, referer, wc.getUserAgent()),
          signal: AbortSignal.any([
            abortRequests.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        if (!response.ok || !response.body) {
          diagnostics('manifest_checked', {
            outcome: 'http_error',
            httpStatus: response.status,
          });
          await response.body?.cancel();
          return false;
        }
        const reader = response.body.getReader();
        let body = '';
        try {
          while (body.length < 512_000) {
            const next = await reader.read();
            if (next.done) break;
            body += new TextDecoder().decode(next.value);
          }
        } finally {
          await reader.cancel();
        }
        if (
          finished ||
          generation !== pageGeneration ||
          body.length >= 512_000
        ) {
          diagnostics('manifest_checked', {
            outcome: finished ? 'cancelled' : 'too_large',
          });
          return false;
        }
        const manifest = inspectWebVideoManifest(body);
        diagnostics('manifest_checked', { outcome: manifest.kind });
        if (manifest.kind === 'invalid') return false;
        if (manifest.kind === 'protected' || manifest.kind === 'live') {
          sources.delete(media);
          protectedVideo ||= manifest.kind === 'protected';
          liveVideo ||= manifest.kind === 'live';
          refresh();
          return false;
        }
        if (manifest.kind === 'master') {
          const children = manifest.variants
            .map(raw => safeWebVideoUrl(raw, media, fixtureOrigin))
            .filter((child): child is string => Boolean(child));
          for (const child of children) {
            childManifests.add(child);
            sources.delete(child);
          }
          // A master playlist alone does not say whether this is a recording or
          // a live broadcast. Validate a media playlist before offering it.
          if (
            !children.length ||
            !(await inspectManifest(children[0], referer, [
              ...ancestors,
              media,
            ]))
          )
            return false;
        }
        if (generation !== pageGeneration) return false;
        add(media, {}, referer);
        return true;
      } catch (error) {
        diagnostics('manifest_checked', {
          outcome: manifestFailureOutcome(error),
        });
        /* Playback can still expose a usable file or another manifest. */
        return false;
      }
    })();
    check.pending = pending.then(usable => {
      check.settled = true;
      check.usable = usable;
      return usable;
    });
    checkedManifests.set(media, check);
    return check.pending;
  };
  siteSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.webContentsId !== wc.id) {
      callback({});
      return;
    }
    const allowed =
      /^(blob:|data:|about:blank)/.test(details.url) ||
      Boolean(safeWebVideoUrl(details.url, undefined, fixtureOrigin));
    callback({ cancel: !allowed });
  });
  siteSession.webRequest.onHeadersReceived((details, callback) => {
    callback({});
    if (
      details.webContentsId !== wc.id ||
      finished ||
      selected ||
      details.statusCode < 200 ||
      details.statusCode >= 300
    )
      return;
    const media = safeWebVideoUrl(details.url, undefined, fixtureOrigin);
    if (!media) return;
    const contentType =
      Object.entries(details.responseHeaders || {})
        .find(([key]) => key.toLowerCase() === 'content-type')?.[1]
        ?.join(';') || '';
    if (
      /mpegurl|dash\+xml/i.test(contentType) ||
      /\.(m3u8|mpd)(?:\?|$)/i.test(media)
    )
      void inspectManifest(media, details.referrer || currentPage);
    // Video elements are authoritative for MP4; network fragments alone are not videos.
  });
  const navigate = (event: Electron.Event, target: string) => {
    if (!safeWebVideoUrl(target, undefined, fixtureOrigin))
      event.preventDefault();
  };
  wc.on('will-navigate', navigate);
  wc.on('will-redirect', navigate);
  wc.on('will-attach-webview', event => event.preventDefault());
  // A popup must never replace the video the user is choosing (common with
  // advertising overlays). Normal navigation and embedded players still work.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const preventDownload = (
    event: Electron.Event,
    _item: unknown,
    contents: WebContents
  ) => {
    if (contents?.id === wc.id) event.preventDefault();
  };
  siteSession.on('will-download', preventDownload);
  const pageChanged = (target: string) => {
    if (!selected) {
      pageGeneration++;
      sources.clear();
      checkedManifests.clear();
      childManifests.clear();
      observedBlobs.clear();
      protectedVideo = false;
      liveVideo = false;
      pickerOpen = false;
      nextFrame = 0;
      layout();
    }
    currentPage = target;
    refresh();
  };
  wc.on('did-navigate', (_event, target) => pageChanged(target));
  wc.on('did-navigate-in-page', (_event, target, isMainFrame) => {
    if (isMainFrame && target !== currentPage) pageChanged(target);
  });
  wc.on('will-prevent-unload', event => event.preventDefault());
  win.on('close', () => finish());
  const cancel = () => finish();
  owner.once('destroyed', cancel);
  signal.addEventListener('abort', cancel, { once: true });
  const result = new Promise<WebVideoSource[]>((resolve, reject) => {
    closeBrowser = outcome => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      abortRequests.abort();
      signal.removeEventListener('abort', cancel);
      owner.removeListener('destroyed', cancel);
      siteSession.webRequest.onBeforeRequest(null);
      siteSession.webRequest.onHeadersReceived(null);
      siteSession.removeListener('will-download', preventDownload);
      busySessions.delete(siteSession);
      if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
      if (!win.isDestroyed()) win.destroy();
      diagnostics('browser_closed', {
        outcome,
        count: sources.size,
      });
      if (!selected) reject(new CancelledError());
    };
    finish = chosen => {
      if (finished) return;
      if (!chosen) {
        browser.cancelled = true;
        closeBrowser('cancelled');
        options.onCancel();
      } else if (!selected) {
        chosen.browser = browser;
        selected = chosen;
        if (timer) clearInterval(timer);
        abortRequests.abort();
        pickerOpen = false;
        layout();
        refresh();
        resolve([chosen]);
      }
    };
  });
  // A close/abort can happen while loadURL is still pending.
  void result.catch(() => {});
  win.webContents.on('will-navigate', event => event.preventDefault());
  // Toolbar actions use denied popup requests, so its document never navigates.
  win.webContents.setWindowOpenHandler(({ url: action }) => {
    if (action === 'stage5-web-video:choose' && sources.size && !selected) {
      pickerOpen = !pickerOpen;
      if (pickerOpen) diagnostics('picker_opened', { count: sources.size });
      layout();
      refresh();
    }
    if (
      action.startsWith('stage5-web-video:select/') &&
      pickerOpen &&
      !selected
    ) {
      const id = action.slice('stage5-web-video:select/'.length);
      const chosen = [...sources.values()].find(
        source => source.candidate.id === id
      );
      if (chosen) {
        diagnostics('selection_confirmed', { count: sources.size });
        finish(chosen);
      }
    }
    if (action === 'stage5-web-video:cancel') finish();
    return { action: 'deny' };
  });
  const html = `<!doctype html><html dir="${labels.direction === 'rtl' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:0;background:#101014;color:#f4f4f5;font:14px system-ui}header{height:90px;box-sizing:border-box;padding:14px 20px;display:flex;align-items:center;gap:20px}section{flex:1;min-width:0}strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}p{margin:5px 0;color:#b1b1bb}a{color:#eee;text-decoration:none;padding:10px 15px;border-radius:9px;white-space:nowrap}a:focus-visible{outline:2px solid #ffe050;outline-offset:-2px}#choose{background:#ffe050;color:#171717;font-weight:650;pointer-events:none;opacity:.45}#videos{box-sizing:border-box;overflow:auto;padding:0 20px 12px}.video{display:flex;align-items:center;gap:14px;margin-bottom:6px;border:1px solid #393940}.video:hover{border-color:#ffe050}.number,small{color:#b1b1bb}small{display:block;margin-top:4px}</style><header><section><strong id="host">${escapeHtml(new URL(url).hostname)}</strong><p id="hint">${escapeHtml(labels.instruction)}</p></section><a target="_blank" href="stage5-web-video:cancel">${escapeHtml(labels.cancel)}</a><a id="choose" aria-disabled="true" aria-expanded="false" aria-controls="videos" target="_blank" href="stage5-web-video:choose">${escapeHtml(labels.choose)}</a></header><nav id="videos" aria-label="${escapeHtml(labels.choose)}" hidden></nav>`;
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );
    if (signal.aborted || owner.isDestroyed()) {
      finish();
      return result;
    }
    win.show();
    diagnostics('browser_opened');
    void wc.loadURL(url).catch(() => {});
    timer = setInterval(async () => {
      if (scanning || finished || wc.isDestroyed()) return;
      scanning = true;
      const generation = pageGeneration;
      try {
        const frames = wc.mainFrame.framesInSubtree;
        if (frameCount !== frames.length) {
          frameCount = frames.length;
          diagnostics('frames_observed', { count: frameCount });
        }
        // Keep each scan bounded, but visit every frame over successive scans.
        // Otherwise pages with many embeds permanently hide players after #20.
        nextFrame %= Math.max(1, frames.length);
        const batch = frames.slice(nextFrame, nextFrame + 20);
        nextFrame = (nextFrame + batch.length) % Math.max(1, frames.length);
        for (const frame of batch) {
          const rows = await frame
            .executeJavaScript(
              `(()=>{const videos=[...document.querySelectorAll('video')].slice(0,20).map(v=>({url:v.currentSrc||v.src||v.querySelector('source')?.src,title:v.title||v.getAttribute('aria-label')||document.title,durationSec:Number.isFinite(v.duration)?v.duration:undefined,width:v.videoWidth||undefined,height:v.videoHeight||undefined,thumbnailUrl:v.poster||undefined,protected:Boolean(v.mediaKeys)})); const embeds=[...document.querySelectorAll('iframe')].filter(f=>/https?:\\/\\/(www\\.)?(youtube(-nocookie)?\\.com\\/embed\\/|player\\.vimeo\\.com\\/video\\/)/i.test(f.src)).map(f=>({url:f.src,title:f.title||document.title}));return [...videos,...embeds]})()`
            )
            .catch(() => []);
          if (!Array.isArray(rows)) continue;
          if (generation !== pageGeneration) break;
          for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            if (row.protected) {
              protectedVideo = true;
              refresh();
              continue;
            }
            if (typeof row.url !== 'string') continue;
            if (row.url.startsWith('blob:') && !observedBlobs.has(row.url)) {
              observedBlobs.add(row.url);
              diagnostics('blob_observed', { kind: 'blob' });
            }
            const detail = {
              title: String(row.title || '').slice(0, 240),
              durationSec:
                typeof row.durationSec === 'number' && row.durationSec > 0
                  ? row.durationSec
                  : undefined,
              width: row.width,
              height: row.height,
              thumbnailUrl:
                safeWebVideoUrl(row.thumbnailUrl, frame.url, fixtureOrigin) ||
                undefined,
            };
            const media = safeWebVideoUrl(row.url, frame.url, fixtureOrigin);
            if (
              media &&
              (/\.(m3u8|mpd)(?:\?|$)/i.test(media) ||
                checkedManifests.has(media))
            )
              void inspectManifest(media, frame.url);
            else add(row.url, detail, frame.url);
          }
        }
      } catch {
        /* Frame navigated or was removed. */
      } finally {
        scanning = false;
      }
    }, 750);
  } catch {
    finish();
  }
  return result;
}
