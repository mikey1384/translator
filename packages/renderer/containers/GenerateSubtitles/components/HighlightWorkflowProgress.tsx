import { css } from '@emotion/css';
import Button from '../../../components/Button.js';
import { useTranslation } from 'react-i18next';
import {
  colors,
  progressBarBackgroundStyles,
  progressBarFillStyles,
} from '../../../styles.js';
import {
  borderRadius,
  fontSize,
  fontWeight,
  spacing,
} from '../../../components/design-system/tokens.js';

type HighlightWorkflowProgressProps = {
  title: string;
  stage: string;
  progress: number;
  onCancel?: () => void;
  isCancelling?: boolean;
  className?: string;
};

const shellStyles = css`
  margin-top: ${spacing.md};
  padding: ${spacing.lg};
  border: 1px solid rgba(125, 167, 255, 0.26);
  border-radius: ${borderRadius.xl};
  background: rgba(20, 30, 46, 0.72);
  display: grid;
  gap: ${spacing.sm};
`;

const headerStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.md};
`;

const titleStyles = css`
  margin: 0;
  color: ${colors.text};
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.01em;
`;

const stageRowStyles = css`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: ${spacing.md};
`;

const stageTextStyles = css`
  color: ${colors.text};
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.medium};
`;

const percentStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-variant-numeric: tabular-nums;
`;

export default function HighlightWorkflowProgress({
  title,
  stage,
  progress,
  onCancel,
  isCancelling = false,
  className,
}: HighlightWorkflowProgressProps) {
  const { t } = useTranslation();
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));

  return (
    <div className={`${shellStyles} ${className ?? ''}`.trim()}>
      <div className={headerStyles}>
        <h4 className={titleStyles}>{title}</h4>
        {onCancel ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={isCancelling}
            isLoading={isCancelling}
          >
            {t('summary.cancel', 'Cancel')}
          </Button>
        ) : null}
      </div>
      <div className={stageRowStyles}>
        <span className={stageTextStyles}>{stage}</span>
        <span className={percentStyles}>{Math.round(safeProgress)}%</span>
      </div>
      <div className={progressBarBackgroundStyles}>
        <div className={progressBarFillStyles(safeProgress)} />
      </div>
    </div>
  );
}
