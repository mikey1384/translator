import { app, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lookup } from 'node:dns/promises';
import log from 'electron-log';
import type {
  DiscoverWebVideoOptions,
  DiscoverWebVideoResult,
} from '@shared-types/app';
import { normalizeVideoUrlInput } from '../../shared/helpers/video-url.js';
import { shouldDiscoverWebVideo } from '../../shared/helpers/web-video.js';
import { CancelledError } from '../../shared/cancelled-error.js';
import {
  registerAutoCancel,
  finish,
  cancelSafely,
} from '../active-processes.js';
import {
  ensureYtDlpBinary,
  shouldSkipYtDlpUpdateFromEnv,
} from '../services/url-processor/binary-installer.js';
import { exportCookiesToFileForUrl } from '../services/url-processor/site-cookies.js';
import { discoverVideosInBrowser } from '../services/web-video-browser.js';
import { createWebVideoDiagnostics } from '../services/web-video-diagnostics.js';
import {
  safeWebVideoUrl,
  sourcesFromYtDlp,
  WebVideoDiscoveries,
  isProtectedWebVideoError,
} from '../services/web-video-model.js';

const execFileAsync = promisify(execFile);
export const webVideoDiscoveries = new WebVideoDiscoveries();
const ownerListeners = new Set<number>();

export function webVideoFixtureOrigin(): string | undefined {
  if (!app.isPackaged && process.env.TRANSLATOR_AGENT_DEV === '1') {
    const value = process.env.TRANSLATOR_WEB_VIDEO_FIXTURE_ORIGIN;
    try {
      if (value && ['127.0.0.1', 'localhost'].includes(new URL(value).hostname))
        return new URL(value).origin;
    } catch {
      /* No fixture. */
    }
  }
  return undefined;
}

export async function handleDiscoverWebVideo(
  event: IpcMainInvokeEvent,
  options: DiscoverWebVideoOptions
): Promise<DiscoverWebVideoResult> {
  const url = normalizeVideoUrlInput(options?.url);
  const operationId = String(options?.operationId || '');
  const fixtureOrigin = webVideoFixtureOrigin();
  if (
    !url ||
    !operationId ||
    operationId.length > 200 ||
    !safeWebVideoUrl(url, undefined, fixtureOrigin)
  )
    return { success: false, errorCode: 'discovery_failed' };
  if (!shouldDiscoverWebVideo(url)) return { success: true, candidates: [] };
  const diagnostics = createWebVideoDiagnostics(entry =>
    log.info('[web-video]', JSON.stringify(entry))
  );
  diagnostics('discovery_started');
  const controller = new AbortController();
  let phase = 'address-check';
  let outcome:
    | 'ok'
    | 'failed'
    | 'protected'
    | 'browser_required'
    | 'cancelled' = 'failed';
  let candidateCount = 0;
  registerAutoCancel(operationId, event.sender, () => controller.abort());
  if (!ownerListeners.has(event.sender.id)) {
    ownerListeners.add(event.sender.id);
    event.sender.once('destroyed', () => {
      webVideoDiscoveries.remove(event.sender.id);
      ownerListeners.delete(event.sender.id);
    });
  }
  try {
    if (new URL(url).origin !== fixtureOrigin) {
      const addresses = await lookup(new URL(url).hostname, { all: true });
      if (
        !addresses.length ||
        addresses.some(
          ({ address }) =>
            !safeWebVideoUrl(
              `https://${address.includes(':') ? `[${address}]` : address}`
            )
        )
      )
        return { success: false, errorCode: 'discovery_failed' };
    }
    if (controller.signal.aborted) throw new CancelledError();
    phase = 'downloader-setup';
    const binary = await ensureYtDlpBinary({
      signal: controller.signal,
      skipUpdate: shouldSkipYtDlpUpdateFromEnv(),
    });
    phase = 'page-probe';
    const cookies = await exportCookiesToFileForUrl(url);
    let sources: ReturnType<typeof sourcesFromYtDlp> = [];
    let drm = false;
    try {
      const { stdout } = await execFileAsync(
        binary,
        [
          url,
          '--ignore-config',
          '--dump-single-json',
          '--skip-download',
          '--flat-playlist',
          '--playlist-end',
          '20',
          '--socket-timeout',
          '8',
          '--retries',
          '0',
          '--no-warnings',
          '--no-cache-dir',
          ...(cookies.count ? ['--cookies', cookies.path] : []),
        ],
        {
          signal: controller.signal,
          timeout: 20_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          encoding: 'utf8',
        }
      );
      const raw = JSON.parse(stdout);
      sources = sourcesFromYtDlp(raw, url, fixtureOrigin);
      diagnostics('page_probe_finished', {
        outcome: 'ok',
        count: sources.length,
      });
      drm = Boolean(raw.has_drm);
    } catch (error: any) {
      if (controller.signal.aborted) throw new CancelledError();
      drm = isProtectedWebVideoError(String(error.stderr || ''));
      diagnostics('page_probe_finished', {
        outcome: drm ? 'protected' : 'failed',
      });
    }
    if (drm && !sources.length) {
      outcome = 'protected';
      return { success: false, errorCode: 'protected_video' };
    }
    if (!sources.length) {
      if (options.interactive === false) {
        outcome = 'browser_required';
        return { success: false, errorCode: 'browser_required' };
      }
      const labels = options.labels;
      if (
        !labels ||
        Object.values(labels).some(
          value => typeof value !== 'string' || value.length > 500
        )
      )
        return { success: false, errorCode: 'discovery_failed' };
      phase = 'browser-discovery';
      sources = await discoverVideosInBrowser({
        url,
        owner: event.sender,
        signal: controller.signal,
        labels,
        fixtureOrigin,
        diagnostics,
        onCancel: () => {
          controller.abort();
          void cancelSafely(operationId);
          if (!event.sender.isDestroyed())
            event.sender.send('url-processing-progress', {
              operationId,
              stage: 'Cancelled',
              percent: 100,
            });
        },
      });
    }
    if (controller.signal.aborted || event.sender.isDestroyed())
      throw new CancelledError();
    if (!sources.length) return { success: false, errorCode: 'no_video' };
    const discoveryId = webVideoDiscoveries.put(event.sender.id, url, sources);
    outcome = 'ok';
    candidateCount = sources.length;
    return {
      success: true,
      discoveryId,
      candidates: sources.map(source => source.candidate),
    };
  } catch (error) {
    if (
      error instanceof CancelledError ||
      controller.signal.aborted ||
      event.sender.isDestroyed()
    ) {
      outcome = 'cancelled';
      return { success: false, cancelled: true };
    }
    log.warn('[web-video] Discovery failed', {
      phase,
      type: error instanceof Error ? error.name : 'unknown',
    });
    return { success: false, errorCode: 'discovery_failed' };
  } finally {
    diagnostics('discovery_finished', { outcome, count: candidateCount });
    finish(operationId);
  }
}

export async function handleReleaseWebVideoDiscovery(
  event: IpcMainInvokeEvent,
  id: string
): Promise<void> {
  if (typeof id === 'string') webVideoDiscoveries.remove(event.sender.id, id);
}
