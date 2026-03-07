import log from 'electron-log';
import fsp from 'node:fs/promises';
import type { ProgressCallback, VideoQuality } from './types.js';
import type { DownloadProcess as DownloadProcessType } from '../../active-processes.js';
import { consumeCancelMarker } from '../../utils/cancel-markers.js';
import { PROGRESS } from './constants.js';
import type { FFmpegContext } from '../ffmpeg-runner.js';
import type { FileManager } from '../file-manager.js';
import path from 'node:path';
import { CancelledError } from '../../../shared/cancelled-error.js';

type NeedCookiesCause =
  | '429'
  | 'login_required'
  | 'captcha_not_a_bot'
  | 'other';
type NeedCookiesCounters = Record<NeedCookiesCause, number>;

type DownloadVideoFromPlatformFn =
  typeof import('./download.js').downloadVideoFromPlatform;
type ExportCookiesToFileForUrlFn =
  typeof import('./site-cookies.js').exportCookiesToFileForUrl;

type ProcessVideoUrlDependencies = {
  downloadVideoFromPlatformImpl?: DownloadVideoFromPlatformFn;
  exportCookiesToFileForUrlImpl?: ExportCookiesToFileForUrlFn;
  waitImpl?: (ms: number) => Promise<void>;
};

async function defaultDownloadVideoFromPlatform(
  ...args: Parameters<DownloadVideoFromPlatformFn>
): ReturnType<DownloadVideoFromPlatformFn> {
  const { downloadVideoFromPlatform } = await import('./download.js');
  return downloadVideoFromPlatform(...args);
}

async function defaultExportCookiesToFileForUrl(
  ...args: Parameters<ExportCookiesToFileForUrlFn>
): ReturnType<ExportCookiesToFileForUrlFn> {
  const { exportCookiesToFileForUrl } = await import('./site-cookies.js');
  return exportCookiesToFileForUrl(...args);
}

const NEED_COOKIES_RATE_LIMIT_RE = /429|too\s*many\s*requests|rate[- ]?limit/;
const NEED_COOKIES_LOGIN_REQUIRED_RE =
  /login_required|authentication\s*required|sign\s*in\s*to\s*confirm/;
const NEED_COOKIES_CONSENT_INTERSTITIAL_RE =
  /consent\.youtube\.com|before\s*you\s*continue\s*to\s*youtube|consent\s*required|youtube\s*consent\s*page/;
const NEED_COOKIES_CAPTCHA_RE =
  /confirm\s*(you|you'?re)\s*not\s*(a\s*)?bot|verify\s*(you|you'?re)\s*(are\s*)?(human|not\s*(a\s*)?bot)|not\s*a\s*bot|captcha|recaptcha|human\s*verification|challenge\s*required/;

function makeNeedCookiesCounters(): NeedCookiesCounters {
  return {
    '429': 0,
    login_required: 0,
    captcha_not_a_bot: 0,
    other: 0,
  };
}

const needCookiesCountersTotal: NeedCookiesCounters = makeNeedCookiesCounters();
const needCookiesCountersByHost = new Map<string, NeedCookiesCounters>();

function incrementNeedCookiesCounters(
  cause: NeedCookiesCause,
  host: string
): {
  total: NeedCookiesCounters;
  hostTotal: NeedCookiesCounters;
} {
  needCookiesCountersTotal[cause] += 1;

  let hostCounters = needCookiesCountersByHost.get(host);
  if (!hostCounters) {
    hostCounters = makeNeedCookiesCounters();
    needCookiesCountersByHost.set(host, hostCounters);
  }
  hostCounters[cause] += 1;

  return {
    total: { ...needCookiesCountersTotal },
    hostTotal: { ...hostCounters },
  };
}

export async function updateYtDlp(): Promise<boolean> {
  try {
    const { ensureYtDlpBinary } = await import('./binary-installer.js');
    await ensureYtDlpBinary();
    return true;
  } catch (error) {
    log.error('[URLprocessor] Failed to update yt-dlp:', error);
    return false;
  }
}

export async function processVideoUrl(
  url: string,
  quality: VideoQuality,
  progressCallback: ProgressCallback | undefined,
  operationId: string,
  services?: {
    fileManager: FileManager;
    ffmpeg: FFmpegContext;
  },
  dependencies: ProcessVideoUrlDependencies = {}
): Promise<{
  videoPath: string;
  filename: string;
  size: number;
  fileUrl: string;
  originalVideoPath: string;
  proc: DownloadProcessType;
}> {
  log.info(`[URLprocessor] processVideoUrl CALLED (Op ID: ${operationId})`);

  if (!services?.fileManager) {
    throw new Error('FileManager instance is required for processVideoUrl');
  }
  const tempDir = services.fileManager.getTempDir();
  log.info(
    `[URLprocessor] processVideoUrl using tempDir from FileManager: ${tempDir}`
  );

  if (!services?.ffmpeg) {
    throw new Error('FFmpegContext is required for processVideoUrl');
  }
  const { ffmpeg } = services;
  const downloadVideo =
    dependencies.downloadVideoFromPlatformImpl || defaultDownloadVideoFromPlatform;
  const exportCookies =
    dependencies.exportCookiesToFileForUrlImpl ||
    defaultExportCookiesToFileForUrl;
  const waitImpl =
    dependencies.waitImpl || (async (ms: number) =>
      new Promise(resolve => setTimeout(resolve, ms)));

  try {
    // Normalize YouTube Shorts to watch URL to improve extractor stability
    try {
      const u = new URL(url);
      if (
        /(^|\.)youtube\.com$/.test(u.hostname) &&
        /^\/shorts\//.test(u.pathname)
      ) {
        const id = u.pathname.split('/')[2];
        if (id) {
          url = `https://www.youtube.com/watch?v=${id}`;
          log.info(`[URLprocessor] Rewrote Shorts URL to watch: ${url}`);
        }
      }
    } catch {
      // ignore
    }
    new URL(url);
  } catch {
    throw new Error('Invalid URL provided.');
  }

  // --- Download attempt ---
  const run = async (extraArgs: string[]) => {
    const downloadResult = await downloadVideo(
      url,
      tempDir,
      quality,
      progressCallback,
      operationId,
      { ffmpeg },
      extraArgs
    );
    const stats = await fsp.stat(downloadResult.filepath);
    const filename = path.basename(downloadResult.filepath);
    progressCallback?.({
      percent: PROGRESS.FINAL_END,
      stage: 'Download complete',
    });

    return {
      videoPath: downloadResult.filepath,
      filename,
      size: stats.size,
      fileUrl: `file://${downloadResult.filepath}`,
      originalVideoPath: downloadResult.filepath,
      proc: downloadResult.proc,
    };
  };

  try {
    return await run([]);
  } catch (err: any) {
    const host = new URL(url).hostname;
    const throwIfCancelled = (context: string): void => {
      if (!consumeCancelMarker(operationId)) return;
      log.info(
        `[URLprocessor] Cancellation marker consumed (${context}) (Op ID: ${operationId})`
      );
      throw new CancelledError();
    };
    const waitWithCancelChecks = async (
      totalMs: number,
      context: string
    ): Promise<void> => {
      const pollMs = 200;
      let remainingMs = totalMs;
      while (remainingMs > 0) {
        throwIfCancelled(context);
        const sliceMs = Math.min(pollMs, remainingMs);
        await waitImpl(sliceMs);
        remainingMs -= sliceMs;
      }
      throwIfCancelled(context);
    };
    const classify = (error: any) => {
      const combined = `${error?.message ?? ''}\n${error?.stderr ?? ''}\n${
        error?.stdout ?? ''
      }\n${error?.all ?? ''}`;
      const combinedLC = combined.toLowerCase();
      return {
        looksSuspicious: NEED_COOKIES_RATE_LIMIT_RE.test(combinedLC),
        hasLoginRequired: NEED_COOKIES_LOGIN_REQUIRED_RE.test(combinedLC),
        hasConsentInterstitial:
          NEED_COOKIES_CONSENT_INTERSTITIAL_RE.test(combinedLC),
        hasCaptchaOrHumanCheck: NEED_COOKIES_CAPTCHA_RE.test(combinedLC),
      };
    };
    const requestNeedCookies = (
      cause: NeedCookiesCause,
      reason: string
    ): never => {
      const counts = incrementNeedCookiesCounters(cause, host);
      log.info(
        `[URLprocessor] NeedCookies triggered (host=${host}, cause=${cause}, reason=${reason}, op=${operationId}, total=${JSON.stringify(counts.total)}, hostTotal=${JSON.stringify(counts.hostTotal)})`
      );
      progressCallback?.({
        percent: PROGRESS.WARMUP_END,
        stage: 'NeedCookies',
      });
      throw new Error('NeedCookies');
    };
    const getCookieCountForGating = async (): Promise<number | null> => {
      try {
        const exported = await exportCookies(url);
        return exported.count;
      } catch (cookieErr) {
        // If we can't determine cookie availability, do not mask the real error.
        log.warn(
          '[URLprocessor] Failed to check/export app cookies for NeedCookies gating:',
          cookieErr
        );
        return null;
      }
    };

    const firstCheck = classify(err);

    // For login/captcha/human-check errors, always allow reconnect even if cookies exist
    // (cookies can be expired/invalid).
    if (firstCheck.hasLoginRequired || firstCheck.hasConsentInterstitial) {
      requestNeedCookies(
        'login_required',
        firstCheck.hasConsentInterstitial
          ? 'consentInterstitial=true'
          : 'loginCheck=true'
      );
    }
    if (firstCheck.hasCaptchaOrHumanCheck) {
      requestNeedCookies('captcha_not_a_bot', 'humanCheck=true');
    }

    // For pure rate-limit (429-ish) errors, prefer a delayed retry once before forcing
    // users into a connect/login flow.
    if (firstCheck.looksSuspicious) {
      const retryDelayMs = 4000;
      log.warn(
        `[URLprocessor] Rate-limit detected for host=${host}; waiting ${retryDelayMs}ms before retrying once.`
      );
      progressCallback?.({
        percent: PROGRESS.WARMUP_END,
        stage: 'Rate limited, retrying...',
      });
      await waitWithCancelChecks(
        retryDelayMs,
        'rate-limit backoff before one-shot retry'
      );

      try {
        return await run([]);
      } catch (retryErr: any) {
        const retryCheck = classify(retryErr);

        if (retryCheck.hasLoginRequired || retryCheck.hasConsentInterstitial) {
          requestNeedCookies(
            'login_required',
            retryCheck.hasConsentInterstitial
              ? 'consentInterstitial=true, after429Retry=true'
              : 'loginCheck=true, after429Retry=true'
          );
        }
        if (retryCheck.hasCaptchaOrHumanCheck) {
          requestNeedCookies(
            'captcha_not_a_bot',
            'humanCheck=true, after429Retry=true'
          );
        }

        if (retryCheck.looksSuspicious) {
          // Only request cookies when we don't already have app-managed cookies.
          const cookieCount = await getCookieCountForGating();
          if (cookieCount === 0) {
            requestNeedCookies('429', '429-ish=true, afterRetry=true');
          }
          if (cookieCount && cookieCount > 0) {
            log.info(
              `[URLprocessor] Rate-limit persisted after retry, but app cookies already exist for host=${host}; surfacing original error instead of NeedCookies.`
            );
          }
        }

        throw retryErr;
      }
    }

    throw err; // not a 429 / cookie-related flow => let normal error flow handle it
  }
}

export { VideoQuality };
