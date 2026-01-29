import { css } from '@emotion/css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/Button';
import { colors } from '../../styles';
import { useUrlStore } from '../../state/url-store';

const DEFAULT_URL = 'https://www.youtube.com/';

type CookieStatus = {
  count: number;
  hasYouTubeAuth: boolean;
};

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    // Common user input: "youtube.com" without scheme
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return null;
    }
  }
}

export default function SiteConnectionSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState(() => {
    const current = useUrlStore.getState().urlInput.trim();
    return current || DEFAULT_URL;
  });

  const api = (window as any).electron as
    | {
        connectCookiesForUrl?: (url: string) => Promise<{
          success: boolean;
          cookiesWritten: number;
          cancelled: boolean;
          error?: string;
        }>;
        clearCookiesForUrl?: (url: string) => Promise<void>;
        getCookiesStatusForUrl?: (url: string) => Promise<CookieStatus>;
      }
    | undefined;

  const canManage = Boolean(
    api?.connectCookiesForUrl && api?.clearCookiesForUrl
  );

  const normalizedUrl = useMemo(() => {
    return normalizeUrl(targetUrl);
  }, [targetUrl]);

  const hostname = useMemo(() => {
    try {
      return normalizedUrl ? new URL(normalizedUrl).hostname : '';
    } catch {
      return '';
    }
  }, [normalizedUrl]);

  const statusLabel = useMemo(() => {
    if (!canManage)
      return t('settings.siteConnection.unavailable', 'Unavailable');
    if (!normalizedUrl)
      return t('settings.siteConnection.invalidUrl', 'Enter a valid URL');
    if (loading) return t('settings.siteConnection.checking', 'Checking…');
    if (!status) return t('settings.siteConnection.checking', 'Checking…');
    if (status.count === 0)
      return t('settings.siteConnection.notConnected', 'Not connected');
    if (status.hasYouTubeAuth)
      return t(
        'settings.siteConnection.connectedSignedIn',
        'Connected (signed in)'
      );
    return t('settings.siteConnection.connected', 'Connected');
  }, [canManage, loading, normalizedUrl, status, t]);

  useEffect(() => {
    // Clear any prior error while the user edits the URL.
    setError(null);
  }, [targetUrl]);

  const refreshStatus = useCallback(
    async (url: string) => {
      if (!api?.getCookiesStatusForUrl) return;
      setLoading(true);
      try {
        const s = await api.getCookiesStatusForUrl(url);
        setStatus(s);
        setError(null);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    // Keep the displayed status in sync with the entered site.
    // Debounce to avoid spamming IPC while the user is typing.
    setStatus(null);
    if (!normalizedUrl) return;
    const timer = setTimeout(() => {
      refreshStatus(normalizedUrl).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [normalizedUrl, refreshStatus]);

  const connect = async () => {
    if (!api?.connectCookiesForUrl || busy) return;
    const valid = normalizeUrl(targetUrl);
    if (!valid) {
      setError(t('errors.invalidUrl', 'The URL format appears invalid.'));
      return;
    }
    setBusy(true);
    try {
      const res = await api.connectCookiesForUrl(valid);
      if (res?.success !== true) {
        if (!res?.cancelled) {
          setError(
            res?.error ||
              t('errors.connectFailed', 'Could not connect. Please try again.')
          );
        }
        return;
      }
      await refreshStatus(valid);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!api?.clearCookiesForUrl || busy) return;
    const valid = normalizeUrl(targetUrl);
    if (!valid) {
      setError(t('errors.invalidUrl', 'The URL format appears invalid.'));
      return;
    }
    let isYouTube = false;
    try {
      const host = new URL(valid).hostname.toLowerCase();
      isYouTube =
        host === 'youtu.be' ||
        host === 'youtube.com' ||
        host.endsWith('.youtube.com');
    } catch {
      isYouTube = false;
    }
    const ok = window.confirm(
      t(
        'settings.siteConnection.clearConfirm',
        isYouTube
          ? 'This will sign you out of YouTube inside Translator. Continue?'
          : 'This will sign you out of this site inside Translator. Continue?'
      )
    );
    if (!ok) return;

    setBusy(true);
    try {
      await api.clearCookiesForUrl(valid);
      await refreshStatus(valid);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={css`
        max-width: 700px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      `}
    >
      <h2
        className={css`
          font-size: 1.2rem;
          margin: 0 0 6px;
          color: ${colors.text};
        `}
      >
        {t('settings.siteConnection.title', 'Website connection')}
      </h2>

      <div
        className={css`
          border: 1px solid ${colors.border};
          background: ${colors.surface};
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        `}
      >
        <div
          className={css`
            display: flex;
            flex-direction: column;
            gap: 8px;
          `}
        >
          <label
            className={css`
              font-size: 0.9rem;
              color: ${colors.grayDark};
            `}
          >
            {t('settings.siteConnection.siteUrlLabel', 'Site URL')}
          </label>
          <input
            type="url"
            value={targetUrl}
            onChange={e => setTargetUrl(e.target.value)}
            disabled={!canManage || busy}
            placeholder={DEFAULT_URL}
            className={css`
              width: 100%;
              padding: 10px 12px;
              border: 1px solid ${colors.border};
              border-radius: 10px;
              background: #fff;
              font-size: 0.95rem;

              &:focus {
                outline: none;
                border-color: ${colors.primary};
                box-shadow: 0 0 0 3px ${colors.primary}20;
              }
            `}
          />
        </div>

        <div
          className={css`
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
          `}
        >
          <div
            className={css`
              font-weight: 600;
              color: ${colors.text};
            `}
          >
            {statusLabel}
            {status && !loading && canManage && status.count > 0 ? (
              <span
                className={css`
                  font-weight: normal;
                  color: ${colors.grayDark};
                `}
              >
                {' '}
                ({status.count})
              </span>
            ) : null}
            {hostname && !loading ? (
              <span
                className={css`
                  font-weight: normal;
                  color: ${colors.grayDark};
                `}
              >
                {' '}
                — {hostname}
              </span>
            ) : null}
          </div>

          <div
            className={css`
              display: flex;
              gap: 10px;
              align-items: center;
              flex-wrap: wrap;
            `}
          >
            <Button
              variant="success"
              onClick={connect}
              disabled={!canManage || busy}
            >
              {busy
                ? t('input.connecting', 'Connecting…')
                : t('input.connect', 'Connect')}
            </Button>
            <Button
              variant="danger"
              onClick={clear}
              disabled={!canManage || busy || !status || status.count === 0}
            >
              {t('common.clear', 'Clear')}
            </Button>
          </div>
        </div>

        <div
          className={css`
            font-size: 0.9rem;
            color: ${colors.grayDark};
            line-height: 1.4;
          `}
        >
          {t(
            'input.connectTip',
            'Tip: In the Connect window, sign in or complete the check, then close the window to continue.'
          )}
        </div>

        {error ? (
          <div
            className={css`
              font-size: 0.9rem;
              color: ${colors.danger};
            `}
          >
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
