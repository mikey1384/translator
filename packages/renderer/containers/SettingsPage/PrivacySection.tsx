import { useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import type { AnalyticsPrivacyState } from '@shared-types/app';
import Section from '../../components/Section';
import Switch from '../../components/Switch';
import * as SystemIPC from '../../ipc/system';
import { settingsCenterColumnStyles } from './styles';
import { colors } from '../../styles';

const privacyStyles = css`
  color: ${colors.text};
  overflow-wrap: anywhere;
`;
const retryStyles = css`
  color: ${colors.text};
  background: ${colors.grayLight};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 10px 16px;
  font: inherit;
  cursor: pointer;
  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  &:focus-visible {
    outline: 2px solid ${colors.primary};
    outline-offset: 3px;
  }
`;

export default function PrivacySection() {
  const { t } = useTranslation();
  const [state, setState] = useState<AnalyticsPrivacyState | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const updates = useRef(0);
  useEffect(() => {
    let alive = true;
    const stop = SystemIPC.onAnalyticsPrivacyChanged(value => {
      updates.current++;
      if (alive) setState(value);
    });
    const revision = updates.current;
    void SystemIPC.getAnalyticsPrivacy()
      .then(value => {
        if (alive && updates.current === revision) setState(value);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  async function update(enabled?: boolean) {
    setBusy(true);
    setError(false);
    const revision = updates.current;
    try {
      const value =
        typeof enabled === 'boolean'
          ? await SystemIPC.setAnalyticsPrivacy(enabled)
          : await SystemIPC.syncAnalyticsPrivacy();
      if (updates.current === revision) setState(value);
    } catch {
      setError(true);
      // A persisted withdrawal can succeed before transport or UI fails.
      try {
        setState(await SystemIPC.getAnalyticsPrivacy());
      } catch {
        /* Keep error visible. */
      }
    } finally {
      setBusy(false);
    }
  }
  const status = error
    ? 'error'
    : !state || busy || state.status === 'saving'
      ? 'saving'
      : state.status === 'pending'
        ? state.enabled
          ? 'pendingOn'
          : 'pendingOff'
        : state.enabled
          ? 'on'
          : 'off';
  return (
    <Section
      destination="settings-privacy"
      title={t('settings.privacy.title')}
      className={cx(settingsCenterColumnStyles, privacyStyles)}
    >
      <p style={{ lineHeight: 1.6, marginTop: 0 }}>
        {t('settings.privacy.description')}
      </p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <strong>{t('settings.privacy.label')}</strong>
        <Switch
          ariaLabel={t('settings.privacy.label')}
          checked={state?.enabled ?? false}
          disabled={!state || busy}
          onChange={enabled => void update(enabled)}
        />
      </div>
      <p role="status" aria-live="polite" style={{ lineHeight: 1.6 }}>
        {t(`settings.privacy.${status}`)}
      </p>
      {(error || state?.status === 'pending') && (
        <button
          type="button"
          className={retryStyles}
          disabled={busy}
          onClick={() => void update()}
        >
          {t('settings.privacy.retry')}
        </button>
      )}
      <p style={{ lineHeight: 1.6, marginBottom: 0 }}>
        {t('settings.privacy.retention')}
      </p>
    </Section>
  );
}
