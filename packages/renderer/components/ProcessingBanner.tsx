import { useTranslation } from 'react-i18next';
import { css } from '@emotion/css';

interface ProcessingBannerProps {
  isVisible: boolean;
  titleKey: string;
  descriptionKey: string;
  icon?: string;
  linkHref?: string;
  linkTextKey?: string;
  onClose?: () => void;
}

export default function ProcessingBanner({
  isVisible,
  titleKey,
  descriptionKey,
  icon = '⏳',
  linkHref,
  linkTextKey,
  onClose,
}: ProcessingBannerProps) {
  const { t } = useTranslation();

  if (!isVisible) return null;

  return (
    <div
      className={css`
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1200;
        background-color: #fff3cd;
        border-bottom: 1px solid #ffeaa7;
        color: #856404;
        padding: 12px 16px;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      `}
    >
      <span
        className={css`
          font-size: 16px;
        `}
      >
        {icon}
      </span>
      <div
        className={css`
          flex: 1;
        `}
      >
        <strong>{t(titleKey)}</strong>
        <br />
        {t(descriptionKey)}{' '}
        {linkHref && linkTextKey && (
          <a
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className={css`
              color: #856404;
              text-decoration: underline;
              cursor: pointer;
              &:hover {
                text-decoration: none;
              }
            `}
          >
            {t(linkTextKey)}
          </a>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className={css`
            background: none;
            border: none;
            color: #856404;
            cursor: pointer;
            font-size: 18px;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            &:hover {
              background-color: rgba(133, 100, 4, 0.1);
              border-radius: 4px;
            }
          `}
          title="Close banner"
        >
          ×
        </button>
      )}
    </div>
  );
} 