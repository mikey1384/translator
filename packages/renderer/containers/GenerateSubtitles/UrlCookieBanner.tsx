import { useEffect } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import { useUrlStore } from '../../state/url-store';
import { useTranslation } from 'react-i18next';
import Button from '../../components/Button';
import { css } from '@emotion/css';

export default function UrlCookieBanner() {
  const { t } = useTranslation();
  const needCookies = useUrlStore(s => s.needCookies);
  const suppressed = useUrlStore(s => s.cookieBannerSuppressed);
  const setNeedCookies = useUrlStore(s => s.setNeedCookies);
  const retryWithCookies = useUrlStore(s => s.retryWithCookies);
  const cookiesBrowser = useUrlStore(s => s.cookiesBrowser);
  const setCookiesBrowser = useUrlStore(s => s.setCookiesBrowser);
  const downloadInProgress = useUrlStore(s => s.download.inProgress);
  const downloadStage = useUrlStore(s => s.download.stage);

  useEffect(() => {
    if (downloadInProgress) {
      setNeedCookies(false);
    }
  }, [downloadInProgress, setNeedCookies]);

  // Auto-select saved or most likely browser when banner appears
  useEffect(() => {
    let alive = true;
    async function pickDefault() {
      try {
        if (!needCookies) return;
        const current = cookiesBrowser;
        if (current && current !== 'auto') return;

        // Prefer user's saved preference; fall back to auto-detect
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
  }, [needCookies]);

  // Hide if cancelled or running; banner is only relevant when explicitly requested
  if (!needCookies || suppressed || downloadInProgress || downloadStage === 'Cancelled')
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
          'YouTube asked for a human check. To continue, retry using your browser cookies.'
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
        <label>{t('input.selectBrowser', 'Browser')}:</label>
        <select
          value={cookiesBrowser}
          onChange={e => setCookiesBrowser(e.target.value)}
          className={css`
            padding: 6px 8px;
          `}
        >
          <option value="chrome">Chrome</option>
          <option value="safari">Safari</option>
          <option value="firefox">Firefox</option>
          <option value="edge">Edge</option>
          <option value="chromium">Chromium</option>
        </select>
        <Button variant="success" onClick={retryWithCookies}>
          {t('input.retryWithCookies', 'Retry with browser cookies')}
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
          'input.cookieAdvice',
          "Make sure the selected browser is the one you're logged into YouTube on."
        )}
        <br />
        {t(
          'input.cookieHelp',
          'Tip: Be signed into YouTube in the selected browser. If you see a consent screen, visit youtube.com once in that browser and accept, then retry here.'
        )}
      </div>
    </div>
  );
}
