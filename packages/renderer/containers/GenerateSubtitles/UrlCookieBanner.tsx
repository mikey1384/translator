import { useEffect, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import { useUrlStore } from '../../state/url-store';
import { useTranslation } from 'react-i18next';
import Button from '../../components/Button';
import { css } from '@emotion/css';

function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.trim());
    return (
      /(^|\\.)youtube\\.com$/.test(u.hostname) || u.hostname === 'youtu.be'
    );
  } catch {
    return false;
  }
}

export default function UrlCookieBanner() {
  const { t } = useTranslation();
  const needCookies = useUrlStore(s => s.needCookies);
  const suppressed = useUrlStore(s => s.cookieBannerSuppressed);
  const urlInput = useUrlStore(s => s.urlInput);
  const setNeedCookies = useUrlStore(s => s.setNeedCookies);
  const downloadMedia = useUrlStore(s => s.downloadMedia);
  const setError = useUrlStore(s => s.setError);
  const downloadInProgress = useUrlStore(s => s.download.inProgress);
  const downloadStage = useUrlStore(s => s.download.stage);
  const [connecting, setConnecting] = useState(false);

  const isYouTube = isYouTubeUrl(urlInput);

  useEffect(() => {
    if (downloadInProgress) {
      setNeedCookies(false);
    }
  }, [downloadInProgress, setNeedCookies]);

  async function connectAndRetry() {
    if (connecting) return;

    const url = urlInput.trim();
    if (!url) return;

    setConnecting(true);
    try {
      const res = await (window as any).electron.connectCookiesForUrl?.(url);
      if (!res) {
        setError(
          t('errors.connectFailed', 'Could not connect. Please try again.')
        );
        return;
      }
      if (res.success !== true) {
        // If the user closed the window without completing the flow, don't treat it as an error.
        if (res.cancelled) return;
        setError(res?.error || t('errors.connectFailed'));
        return;
      }
      // Retry the download; yt-dlp will use the app-managed cookies automatically.
      setNeedCookies(false);
      await downloadMedia();
    } catch (e: any) {
      setError(e?.message || t('errors.connectFailed'));
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
          isYouTube ? 'errors.needCookiesYouTube' : 'errors.needCookiesGeneric',
          isYouTube
            ? 'YouTube asked for a human check. Click Connect to continue.'
            : 'This site asked for a human check. Click Connect to continue.'
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
        <Button variant="success" onClick={connectAndRetry}>
          {connecting
            ? t('input.connecting', 'Connecting…')
            : t('input.connect', 'Connect')}
        </Button>
      </div>
      <div
        className={css`
          font-size: 0.85rem;
          color: #666;
          max-width: 720px;
          text-align: center;
        `}
      >
        {t(
          'input.connectTip',
          'Tip: In the Connect window, sign in or complete the check, then close the window to continue.'
        )}
      </div>
    </div>
  );
}
