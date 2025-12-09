import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { colors } from '../../styles';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ApiKeyGuideModal({ open, onClose }: Props) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className={css`
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `}
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.apiKeyGuide.title', 'How to Get API Keys')}
      onClick={onClose}
    >
      <div
        className={css`
          background: ${colors.surface};
          border: 1px solid ${colors.border};
          border-radius: 10px;
          width: min(640px, 92vw);
          max-height: 85vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        `}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={css`
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid ${colors.border};
          `}
        >
          <h2
            style={{
              color: colors.text,
              fontWeight: 600,
              fontSize: '1.1rem',
              margin: 0,
            }}
          >
            {t('settings.apiKeyGuide.title', 'How to Get API Keys')}
          </h2>
          <button
            onClick={onClose}
            className={css`
              background: transparent;
              border: none;
              color: ${colors.textDim};
              font-size: 1.2rem;
              cursor: pointer;
              padding: 4px 8px;
              &:hover {
                color: ${colors.text};
              }
            `}
            aria-label={t('common.close', 'Close')}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div
          className={css`
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 24px;
          `}
        >
          {/* OpenAI Section */}
          <section>
            <h3
              style={{
                color: colors.text,
                fontWeight: 600,
                fontSize: '1rem',
                margin: '0 0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  background: colors.primary,
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: '.75rem',
                }}
              >
                {t('settings.apiKeyGuide.required', 'Required')}
              </span>
              OpenAI
            </h3>
            <p
              style={{
                color: colors.textDim,
                lineHeight: 1.6,
                margin: '0 0 12px',
                fontSize: '.9rem',
              }}
            >
              {t(
                'settings.apiKeyGuide.openai.description',
                'OpenAI powers transcription (Whisper), translation (GPT), and text-to-speech dubbing.'
              )}
            </p>
            <ol
              style={{
                color: colors.text,
                lineHeight: 1.8,
                margin: 0,
                paddingLeft: 20,
                fontSize: '.9rem',
              }}
            >
              <li>
                {t('settings.apiKeyGuide.openai.step1', 'Go to')}{' '}
                <a
                  href="https://platform.openai.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: colors.primary,
                    textDecoration: 'underline',
                  }}
                >
                  platform.openai.com
                </a>
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.openai.step2',
                  'Sign up or log in to your account'
                )}
              </li>
              <li>
                {t('settings.apiKeyGuide.openai.step3', 'Navigate to')}{' '}
                <strong>API Keys</strong>{' '}
                {t('settings.apiKeyGuide.openai.step3b', 'in the left sidebar')}
              </li>
              <li>
                {t('settings.apiKeyGuide.openai.step4', 'Click')}{' '}
                <strong>Create new secret key</strong>
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.openai.step5',
                  'Add a payment method in Billing settings (required to use the API)'
                )}
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.openai.step6',
                  'Copy the key (starts with sk-) and paste it in Stage5'
                )}
              </li>
            </ol>
            <p
              style={{
                color: colors.textDim,
                fontSize: '.8rem',
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(40, 40, 40, 0.3)',
                borderRadius: 6,
              }}
            >
              {t(
                'settings.apiKeyGuide.openai.note',
                'Tip: New OpenAI accounts often get free credits to start. You only pay for what you use.'
              )}
            </p>
          </section>

          {/* Anthropic Section */}
          <section
            style={{
              borderTop: `1px solid ${colors.border}`,
              paddingTop: 20,
            }}
          >
            <h3
              style={{
                color: colors.text,
                fontWeight: 600,
                fontSize: '1rem',
                margin: '0 0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  background: colors.grayLight,
                  color: colors.textDim,
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: '.75rem',
                  border: `1px solid ${colors.border}`,
                }}
              >
                {t('settings.apiKeyGuide.optional', 'Optional')}
              </span>
              Anthropic (Claude)
            </h3>
            <p
              style={{
                color: colors.textDim,
                lineHeight: 1.6,
                margin: '0 0 12px',
                fontSize: '.9rem',
              }}
            >
              {t(
                'settings.apiKeyGuide.anthropic.description',
                'Claude provides higher-quality translation reviews. Without it, GPT handles all translation tasks.'
              )}
            </p>
            <ol
              style={{
                color: colors.text,
                lineHeight: 1.8,
                margin: 0,
                paddingLeft: 20,
                fontSize: '.9rem',
              }}
            >
              <li>
                {t('settings.apiKeyGuide.anthropic.step1', 'Go to')}{' '}
                <a
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: colors.primary,
                    textDecoration: 'underline',
                  }}
                >
                  console.anthropic.com
                </a>
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.anthropic.step2',
                  'Sign up or log in to your account'
                )}
              </li>
              <li>
                {t('settings.apiKeyGuide.anthropic.step3', 'Go to')}{' '}
                <strong>API Keys</strong>{' '}
                {t('settings.apiKeyGuide.anthropic.step3b', 'in the settings')}
              </li>
              <li>
                {t('settings.apiKeyGuide.anthropic.step4', 'Click')}{' '}
                <strong>Create Key</strong>
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.anthropic.step5',
                  'Add a payment method in Plans & Billing (required to use the API)'
                )}
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.anthropic.step6',
                  'Copy the key (starts with sk-ant-) and paste it in Stage5'
                )}
              </li>
            </ol>
            <p
              style={{
                color: colors.textDim,
                fontSize: '.8rem',
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(40, 40, 40, 0.3)',
                borderRadius: 6,
              }}
            >
              {t(
                'settings.apiKeyGuide.anthropic.note',
                'Tip: Anthropic offers pay-as-you-go pricing. You only pay for what you use.'
              )}
            </p>
          </section>

          {/* ElevenLabs Section */}
          <section
            style={{
              borderTop: `1px solid ${colors.border}`,
              paddingTop: 20,
            }}
          >
            <h3
              style={{
                color: colors.text,
                fontWeight: 600,
                fontSize: '1rem',
                margin: '0 0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  background: colors.grayLight,
                  color: colors.textDim,
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: '.75rem',
                  border: `1px solid ${colors.border}`,
                }}
              >
                {t('settings.apiKeyGuide.optional', 'Optional')}
              </span>
              ElevenLabs
            </h3>
            <p
              style={{
                color: colors.textDim,
                lineHeight: 1.6,
                margin: '0 0 12px',
                fontSize: '.9rem',
              }}
            >
              {t(
                'settings.apiKeyGuide.elevenlabs.description',
                'ElevenLabs offers premium transcription and voice-cloning dubbing. Without it, OpenAI handles these tasks.'
              )}
            </p>
            <ol
              style={{
                color: colors.text,
                lineHeight: 1.8,
                margin: 0,
                paddingLeft: 20,
                fontSize: '.9rem',
              }}
            >
              <li>
                {t('settings.apiKeyGuide.elevenlabs.step1', 'Go to')}{' '}
                <a
                  href="https://elevenlabs.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: colors.primary,
                    textDecoration: 'underline',
                  }}
                >
                  elevenlabs.io
                </a>
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.elevenlabs.step2',
                  'Sign up or log in to your account'
                )}
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.elevenlabs.step3',
                  'Click your profile icon and select'
                )}{' '}
                <strong>Profile + API key</strong>
              </li>
              <li>
                {t(
                  'settings.apiKeyGuide.elevenlabs.step4',
                  'Copy your API key and paste it in Stage5'
                )}
              </li>
            </ol>
            <p
              style={{
                color: colors.textDim,
                fontSize: '.8rem',
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(40, 40, 40, 0.3)',
                borderRadius: 6,
              }}
            >
              {t(
                'settings.apiKeyGuide.elevenlabs.note',
                'Tip: ElevenLabs has a free tier with limited usage. For more, upgrade to a paid plan in your account settings.'
              )}
            </p>
          </section>
        </div>

        {/* Footer */}
        <div
          className={css`
            padding: 14px 20px;
            border-top: 1px solid ${colors.border};
            display: flex;
            justify-content: flex-end;
          `}
        >
          <button
            onClick={onClose}
            className={css`
              background: ${colors.primary};
              color: #fff;
              border: none;
              border-radius: 6px;
              padding: 10px 20px;
              cursor: pointer;
              font-weight: 500;
            `}
          >
            {t('common.gotIt', 'Got it')}
          </button>
        </div>
      </div>
    </div>
  );
}
