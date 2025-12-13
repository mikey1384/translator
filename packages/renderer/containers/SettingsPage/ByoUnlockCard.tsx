import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';
import { useAiStore } from '../../state';
import { logButton } from '../../utils/logger';
import { byoCardStyles } from './styles';
import ApiKeyGuideModal from './ApiKeyGuideModal';

export default function ByoUnlockCard() {
  const { t } = useTranslation();
  const [guideOpen, setGuideOpen] = useState(false);

  const initialized = useAiStore(state => state.initialized);
  const initialize = useAiStore(state => state.initialize);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const entitlementsLoading = useAiStore(state => state.entitlementsLoading);
  const entitlementsError = useAiStore(state => state.entitlementsError);
  const unlockPending = useAiStore(state => state.unlockPending);
  const unlockError = useAiStore(state => state.unlockError);
  const startUnlock = useAiStore(state => state.startUnlock);
  const refreshEntitlements = useAiStore(state => state.refreshEntitlements);

  // Effective BYO unlocked state (respects admin preview mode)
  const effectiveByoUnlocked = byoUnlocked && !adminByoPreviewMode;

  useEffect(() => {
    if (!initialized) {
      initialize().catch(err => {
        console.error('[ByoUnlockCard] init failed', err);
      });
    }
  }, [initialized, initialize]);

  const handleUnlock = async () => {
    logButton('settings_byo_unlock_click');
    await startUnlock();
  };

  // Don't render if already unlocked (unless in admin preview mode)
  if (effectiveByoUnlocked) {
    return null;
  }

  const loading = entitlementsLoading && !byoUnlocked;

  return (
    <section className={byoCardStyles}>
      <h2
        style={{
          fontSize: '1.1rem',
          fontWeight: 600,
          margin: 0,
          color: colors.text,
        }}
      >
        {t('settings.byoOpenAi.title', 'Bring Your Own API Keys')}
      </h2>

      <p
        style={{
          color: colors.textDim,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {t(
          'settings.byoOpenAi.description',
          'Unlock a one-time upgrade to use your own API keys. Once unlocked, any transcription, translation, dubbing, or summary runs directly on your accounts instead of consuming Stage5 credits.'
        )}{' '}
        <button
          onClick={() => {
            logButton('settings_byo_guide_open');
            setGuideOpen(true);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: colors.primary,
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
            font: 'inherit',
          }}
        >
          {t('settings.byoOpenAi.howToGetKeys', 'How do I get API keys?')}
        </button>
      </p>

      <div
        style={{
          background: 'rgba(67,97,238,0.06)',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 600, color: colors.text }}>
          {t('settings.byoOpenAi.economicsTitle', 'Why it’s worth it')}
        </div>
        <div
          style={{ fontSize: '.9rem', color: colors.textDim, lineHeight: 1.4 }}
        >
          {t(
            'settings.byoOpenAi.economicsBody',
            'Stage5 credits optimize for convenience (no setup). BYO pays providers directly—usually ~30–50% cheaper depending on your pack.'
          )}
        </div>
      </div>

      {entitlementsError && (
        <div
          style={{
            background: 'rgba(255,36,66,0.1)',
            border: `1px solid ${colors.danger}`,
            borderRadius: 6,
            padding: '12px 14px',
            color: colors.danger,
          }}
        >
          {entitlementsError}{' '}
          <button
            onClick={() => refreshEntitlements()}
            style={{
              color: colors.primary,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              marginLeft: 6,
            }}
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      )}

      <button
        onClick={handleUnlock}
        disabled={unlockPending || loading}
        style={{
          padding: '12px 16px',
          fontWeight: 600,
          background: colors.primary,
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: unlockPending || loading ? 'wait' : 'pointer',
          opacity: unlockPending || loading ? 0.7 : 1,
        }}
      >
        {unlockPending
          ? t('settings.byoOpenAi.unlocking', 'Opening checkout…')
          : t('settings.byoOpenAi.unlockCta', 'Unlock for $10')}
      </button>

      {unlockError && (
        <p style={{ color: colors.danger, margin: 0 }}>{unlockError}</p>
      )}
      <ApiKeyGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  );
}
