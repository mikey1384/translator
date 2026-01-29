import { useEffect, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import { useUrlStore } from '../../state/url-store';
import { useTranslation } from 'react-i18next';
import Button from '../../components/Button';
import { css } from '@emotion/css';

export default function UrlCookieBanner() {
  const { t } = useTranslation();
  const needCookies = useUrlStore(s => s.needCookies);
  const suppressed = useUrlStore(s => s.cookieBannerSuppressed);
  const urlInput = useUrlStore(s => s.urlInput);
  const setNeedCookies = useUrlStore(s => s.setNeedCookies);
  const downloadMedia = useUrlStore(s => s.downloadMedia);
  const retryWithCookies = useUrlStore(s => s.retryWithCookies);
  const cookiesBrowser = useUrlStore(s => s.cookiesBrowser);
  const setCookiesBrowser = useUrlStore(s => s.setCookiesBrowser);
  const setError = useUrlStore(s => s.setError);
  const downloadInProgress = useUrlStore(s => s.download.inProgress);
  const downloadStage = useUrlStore(s => s.download.stage);
  const [connecting, setConnecting] = useState(false);
  const [platform, setPlatform] = useState<string>('');

  const isYouTube = (() => {
    try {
      const u = new URL(urlInput.trim());
      return /(^|\\.)youtube\\.com$/.test(u.hostname) || u.hostname === 'youtu.be';
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (downloadInProgress) {
      setNeedCookies(false);
    }
  }, [downloadInProgress, setNeedCookies]);

  useEffect(() => {
    let alive = true;
    (window as any).electron
      .getSystemInfo?.()
      .then((info: any) => {
        if (!alive) return;
        if (info?.platform && typeof info.platform === 'string')
          setPlatform(info.platform);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // For non-YouTube sites, allow retry using external browser cookies.
  // Auto-select saved or most likely browser when banner appears.
  useEffect(() => {
    let alive = true;
    async function pickDefault() {
      try {
        if (!needCookies) return;
        if (isYouTube) return;
        const current = cookiesBrowser;
        if (current && current !== 'auto') return;

        const saved = await (
          window as any
        ).electron.getPreferredCookiesBrowser?.();
        if (alive && saved) {
          setCookiesBrowser(saved);
          return;
        }
        const hint = await (window as any).electron.getDefaultCookieBrowser?.();
        if (alive && hint) setCookiesBrowser(hint);
      } catch {
        // ignore
      }
    }
    pickDefault();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needCookies, isYouTube]);

  async function connectYouTubeAndRetry() {
    if (connecting) return;
    setConnecting(true);
    try {
      const res = await (window as any).electron.connectYouTubeCookies?.();
      if (!res) {
        setError(
          t(
            'errors.youtubeConnectFailed',
            'Could not connect YouTube. Please try again.'
          )
        );
        return;
      }
      if (res.success !== true) {
        setError(
          res?.error ||
            t(
              'errors.youtubeConnectFailed',
              'Could not connect YouTube. Please try again.'
            )
        );
        return;
      }
      // Retry the download; yt-dlp will use the exported cookies file automatically.
      setNeedCookies(false);
      await downloadMedia();
    } catch (e: any) {
      setError(
        e?.message ||
          t(
            'errors.youtubeConnectFailed',
            'Could not connect YouTube. Please try again.'
          )
      );
    } finally {
      setConnecting(false);
    }
  }

  // Hide if cancelled or running; banner is only relevant when explicitly requested
  if (
    !needCookies ||
    suppressed ||
    downloadInProgress ||
    downloadStage === 'Cancelled'
  )
    return null;

    return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
      }}
    >
      <ErrorBanner
        message={t(
          'errors.needCookies',
          isYouTube
            ? 'YouTube asked for a human check. To continue, connect YouTube in Translator and retry.'
            : 'This site asked for a human check. To continue, retry using your browser cookies.'
        )}
        onClose={() => setNeedCookies(false)}
      />
      <div
        className={css`
          display: flex;
          gap: 10px;
          align-items: center;
        `}
      >
        {isYouTube ? (
          <Button variant="success" onClick={connectYouTubeAndRetry}>
            {connecting
              ? t('input.connectingYouTube', 'Connecting…')
              : t('input.connectYouTube', 'Connect YouTube')}
          </Button>
        ) : (
          <>
            <label>{t('input.selectBrowser', 'Browser')}:</label>
            <select
              value={cookiesBrowser}
              onChange={e => setCookiesBrowser(e.target.value)}
              className={css`
                padding: 6px 8px;
              `}
            >
              <option value="chrome">Chrome</option>
              {platform === 'darwin' ? (
                <option value="safari">Safari</option>
              ) : null}
              <option value="firefox">Firefox</option>
              <option value="edge">Edge</option>
            </select>
            <Button variant="success" onClick={retryWithCookies}>
              {t('input.retryWithCookies', 'Retry with browser cookies')}
            </Button>
          </>
        )}
      </div>
      <div
        className={css`
          font-size: 0.85rem;
          color: #666;
          max-width: 720px;
          text-align: center;
        `}
      >
        {isYouTube
          ? t(
              'input.cookieAdvice',
              "Tip: In the Connect window, sign in or complete the check, then close the window to continue."
            )
          : t(
              'input.cookieAdvice',
              "Make sure the selected browser is the one you're logged into on."
            )}
      </div>
    </div>
  );
}
