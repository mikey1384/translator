import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/css';
import {
  workflowStatusIconButtonStyles,
  workflowStatusNoticeContentStyles,
  workflowStatusNoticeIconStyles,
  workflowStatusNoticeLinkStyles,
  workflowStatusNoticeShellStyles,
  workflowStatusNoticeTitleStyles,
} from './workflow-surface-styles';

interface ProcessingBannerProps {
  isVisible: boolean;
  titleKey: string;
  descriptionKey: string;
  icon?: ReactNode;
  linkHref?: string;
  linkTextKey?: string;
  onClose?: () => void;
}

const noticeCloseButtonStyles = css`
  margin-left: auto;
  width: 30px;
  height: 30px;
  font-size: 1rem;
`;

function DefaultStatusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l3 2" />
    </svg>
  );
}

export default function ProcessingBanner({
  isVisible,
  titleKey,
  descriptionKey,
  icon = <DefaultStatusIcon />,
  linkHref,
  linkTextKey,
  onClose,
}: ProcessingBannerProps) {
  const { t } = useTranslation();

  if (!isVisible) return null;

  return (
    <div className={workflowStatusNoticeShellStyles}>
      <span className={workflowStatusNoticeIconStyles}>
        {icon}
      </span>
      <div className={workflowStatusNoticeContentStyles}>
        <span className={workflowStatusNoticeTitleStyles}>{t(titleKey)}</span>
        {t(descriptionKey)}{' '}
        {linkHref && linkTextKey && (
          <a
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className={workflowStatusNoticeLinkStyles}
          >
            {t(linkTextKey)}
          </a>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className={`${workflowStatusIconButtonStyles} ${noticeCloseButtonStyles}`}
          title={t('common.closeBanner', 'Close banner')}
          aria-label={t('common.closeBanner', 'Close banner')}
        >
          ×
        </button>
      )}
    </div>
  );
}
