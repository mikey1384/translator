import { useEffect } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import { useUrlStore } from '../../state/url-store';
import { useTranslation } from 'react-i18next';
import Button from '../../components/Button';

export default function UrlCookieBanner() {
  const { t } = useTranslation();
  const needCookies = useUrlStore(s => s.needCookies);
  const setNeedCookies = useUrlStore(s => s.setNeedCookies);
  const retryWithCookies = useUrlStore(s => s.retryWithCookies);
  const downloadInProgress = useUrlStore(s => s.download.inProgress);

  useEffect(() => {
    if (downloadInProgress) {
      setNeedCookies(false);
    }
  }, [downloadInProgress, setNeedCookies]);

  if (!needCookies) return null;

  return (
    <div>
      <ErrorBanner
        message={t(
          'errors.needCookies',
          'YouTube needs a human check. Click below to retry with your browser cookies.'
        )}
        onClose={() => setNeedCookies(false)}
      />
      <Button variant="secondary" onClick={retryWithCookies}>
        {t('input.retryWithCookies', 'Retry with browser cookies')}
      </Button>
    </div>
  );
}
