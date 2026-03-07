import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import {
  modalGuideBodyStyles,
  modalGuideContentStyles,
  modalGuideCopyStyles,
  modalGuideLinkStyles,
  modalGuideListStyles,
  modalGuideNoteStyles,
  modalGuideSectionDividedStyles,
  modalGuideSectionStyles,
  modalGuideStackStyles,
  modalGuideTagOptionalStyles,
  modalGuideTagRequiredStyles,
  modalGuideTagStyles,
  modalGuideTitleRowStyles,
  modalGuideTitleStyles,
} from './styles';

interface Props {
  open: boolean;
  onClose: () => void;
  provider?: 'openai' | 'anthropic' | 'elevenlabs';
}

interface GuideSectionProps {
  sectionRef: RefObject<HTMLElement | null>;
  divided?: boolean;
  badgeLabel: string;
  badgeVariant: 'required' | 'optional';
  title: string;
  description?: string;
  note?: string;
  children: ReactNode;
}

function GuideSection({
  sectionRef,
  divided = false,
  badgeLabel,
  badgeVariant,
  title,
  description,
  note,
  children,
}: GuideSectionProps) {
  return (
    <section
      ref={sectionRef}
      className={cx(
        modalGuideSectionStyles,
        divided && modalGuideSectionDividedStyles
      )}
    >
      <div className={modalGuideTitleRowStyles}>
        <span
          className={cx(
            modalGuideTagStyles,
            badgeVariant === 'required'
              ? modalGuideTagRequiredStyles
              : modalGuideTagOptionalStyles
          )}
        >
          {badgeLabel}
        </span>
        <h3 className={modalGuideTitleStyles}>{title}</h3>
      </div>
      {description ? (
        <p className={modalGuideCopyStyles}>{description}</p>
      ) : null}
      {children}
      {note ? <p className={modalGuideNoteStyles}>{note}</p> : null}
    </section>
  );
}

const listSpacingStyles = css`
  margin-top: -4px;
`;

export default function ApiKeyGuideModal({ open, onClose, provider }: Props) {
  const { t } = useTranslation();
  const openaiRef = useRef<HTMLElement>(null);
  const anthropicRef = useRef<HTMLElement>(null);
  const elevenlabsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open || !provider) return;

    const timer = window.setTimeout(() => {
      const ref =
        provider === 'openai'
          ? openaiRef
          : provider === 'anthropic'
            ? anthropicRef
            : elevenlabsRef;
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    return () => window.clearTimeout(timer);
  }, [open, provider]);

  return (
    <Modal
      open={open}
      title={t('settings.apiKeyGuide.title', 'How to Get API Keys')}
      onClose={onClose}
      contentClassName={modalGuideContentStyles}
      bodyClassName={modalGuideBodyStyles}
      actions={
        <Button variant="primary" onClick={onClose}>
          {t('common.gotIt', 'Got it')}
        </Button>
      }
      closeLabel={t('common.close', 'Close')}
    >
      <div className={modalGuideStackStyles}>
        <GuideSection
          sectionRef={openaiRef}
          badgeLabel={t('settings.apiKeyGuide.required', 'Required')}
          badgeVariant="required"
          title={t('settings.apiKeyGuide.providers.openai', 'OpenAI')}
        >
          <ol className={cx(modalGuideListStyles, listSpacingStyles)}>
            <li>
              {t('settings.apiKeyGuide.openai.step1', 'Go to')}{' '}
              <a
                href="https://platform.openai.com"
                target="_blank"
                rel="noopener noreferrer"
                className={modalGuideLinkStyles}
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
              <strong>
                {t('settings.apiKeyGuide.labels.apiKeys', 'API Keys')}
              </strong>{' '}
              {t('settings.apiKeyGuide.openai.step3b', 'in the left sidebar')}
            </li>
            <li>
              {t('settings.apiKeyGuide.openai.step4', 'Click')}{' '}
              <strong>
                {t(
                  'settings.apiKeyGuide.labels.createNewSecretKey',
                  'Create new secret key'
                )}
              </strong>
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
        </GuideSection>

        <GuideSection
          sectionRef={anthropicRef}
          divided
          badgeLabel={t('settings.apiKeyGuide.optional', 'Optional')}
          badgeVariant="optional"
          title={t(
            'settings.apiKeyGuide.providers.anthropicClaude',
            'Anthropic (Claude)'
          )}
        >
          <ol className={cx(modalGuideListStyles, listSpacingStyles)}>
            <li>
              {t('settings.apiKeyGuide.anthropic.step1', 'Go to')}{' '}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className={modalGuideLinkStyles}
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
              <strong>
                {t('settings.apiKeyGuide.labels.apiKeys', 'API Keys')}
              </strong>{' '}
              {t('settings.apiKeyGuide.anthropic.step3b', 'in the settings')}
            </li>
            <li>
              {t('settings.apiKeyGuide.anthropic.step4', 'Click')}{' '}
              <strong>
                {t('settings.apiKeyGuide.labels.createKey', 'Create Key')}
              </strong>
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
        </GuideSection>

        <GuideSection
          sectionRef={elevenlabsRef}
          divided
          badgeLabel={t('settings.apiKeyGuide.optional', 'Optional')}
          badgeVariant="optional"
          title={t('settings.apiKeyGuide.providers.elevenlabs', 'ElevenLabs')}
          description={t(
            'settings.apiKeyGuide.elevenlabs.ttsDescription',
            'ElevenLabs offers premium transcription and dubbing voices. Without it, OpenAI handles these tasks.'
          )}
        >
          <ol className={cx(modalGuideListStyles, listSpacingStyles)}>
            <li>
              {t('settings.apiKeyGuide.elevenlabs.step1', 'Go to')}{' '}
              <a
                href="https://elevenlabs.io"
                target="_blank"
                rel="noopener noreferrer"
                className={modalGuideLinkStyles}
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
              <strong>
                {t(
                  'settings.apiKeyGuide.labels.profileApiKey',
                  'Profile + API key'
                )}
              </strong>
            </li>
            <li>
              {t(
                'settings.apiKeyGuide.elevenlabs.step4',
                'Add a payment method in Subscription settings (required for API usage beyond free tier)'
              )}
            </li>
            <li>
              {t(
                'settings.apiKeyGuide.elevenlabs.step5',
                'Copy your API key and paste it in Stage5'
              )}
            </li>
          </ol>
        </GuideSection>
      </div>
    </Modal>
  );
}
