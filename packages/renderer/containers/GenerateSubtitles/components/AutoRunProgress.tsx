import { css, cx } from '@emotion/css';
import { Check, ChevronRight, CircleAlert, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../styles.js';
import {
  borderRadius,
  fontSize,
  fontWeight,
  spacing,
} from '../../../components/design-system/tokens.js';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../../constants/translation-languages';
import type { AutoRunTarget } from './MediaInputSection.js';

// Where the running auto-run pipeline currently is. Phases move strictly
// forward: downloading → transcribing → translating → done (or → error).
export type AutoRunPhase =
  | 'downloading'
  | 'transcribing'
  | 'translating'
  | 'done'
  | 'error';

// Which pipeline step a failure happened on, so the error marker lands on the
// right step (download succeeding but transcription failing must not point the
// user at the download step).
export type AutoRunFailedStep = 'download' | 'transcribe' | 'translate';

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface AutoRunProgressProps {
  target: AutoRunTarget;
  phase: AutoRunPhase;
  language: string;
  failedStep?: AutoRunFailedStep;
  onDismiss: () => void;
}

const shellStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.md};
  flex-wrap: wrap;
  margin: ${spacing.md} 0 0;
  padding: ${spacing.md} ${spacing.lg};
  border: 1px solid ${colors.borderStrong};
  border-radius: ${borderRadius['2xl']};
  background-color: ${colors.surface};
`;

const stepsRowStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  flex: 1 1 auto;
  flex-wrap: wrap;
  min-width: 0;
`;

const stepStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.sm};
  font-size: ${fontSize.sm};
  white-space: nowrap;
`;

const iconBaseStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: ${borderRadius.full};
  flex-shrink: 0;
`;

const iconByStatusStyles: Record<StepStatus, string> = {
  pending: css`
    border: 1.5px solid ${colors.border};
    color: ${colors.textDim};
  `,
  active: css`
    background: rgba(125, 167, 255, 0.16);
    color: ${colors.primary};
  `,
  done: css`
    background: ${colors.success};
    color: #fff;
  `,
  error: css`
    background: ${colors.danger};
    color: #fff;
  `,
};

const labelByStatusStyles: Record<StepStatus, string> = {
  pending: css`
    color: ${colors.textDim};
    font-weight: ${fontWeight.medium};
  `,
  active: css`
    color: ${colors.text};
    font-weight: ${fontWeight.semibold};
  `,
  done: css`
    color: ${colors.text};
    font-weight: ${fontWeight.medium};
  `,
  error: css`
    color: ${colors.danger};
    font-weight: ${fontWeight.semibold};
  `,
};

const spinStyles = css`
  animation: auto-run-spin 0.9s linear infinite;
  @keyframes auto-run-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const connectorStyles = css`
  color: ${colors.textDim};
  display: inline-flex;
  align-items: center;
  opacity: 0.6;
`;

const dismissButtonStyles = css`
  appearance: none;
  border: 0;
  background: transparent;
  color: ${colors.textDim};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: ${borderRadius.full};
  margin-left: auto;
  flex-shrink: 0;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: ${colors.text};
  }
`;

function resolveLanguageLabel(value: string, t: (k: string) => string): string {
  const base = TRANSLATION_LANGUAGES_BASE.find(o => o.value === value);
  if (base) return t(base.labelKey);
  for (const group of TRANSLATION_LANGUAGE_GROUPS) {
    const found = group.options.find(o => o.value === value);
    if (found) return t(found.labelKey);
  }
  return value;
}

function StepIcon({ status }: { status: StepStatus }) {
  return (
    <span className={cx(iconBaseStyles, iconByStatusStyles[status])}>
      {status === 'done' ? (
        <Check size={13} strokeWidth={3} />
      ) : status === 'error' ? (
        <CircleAlert size={13} strokeWidth={2.6} />
      ) : status === 'active' ? (
        <Loader2 size={13} strokeWidth={2.6} className={spinStyles} />
      ) : null}
    </span>
  );
}

export default function AutoRunProgress({
  target,
  phase,
  language,
  failedStep,
  onDismiss,
}: AutoRunProgressProps) {
  const { t } = useTranslation();

  const phaseRank: Record<AutoRunPhase, number> = {
    downloading: 0,
    transcribing: 1,
    translating: 2,
    done: 3,
    error: -1,
  };
  const rank = phaseRank[phase];
  const failedStepRank =
    failedStep === 'translate' ? 2 : failedStep === 'transcribe' ? 1 : 0;

  // Each step's status derives purely from the (forward-only) phase, so a stale
  // task-completion flag can never make a later step read as done prematurely.
  const statusFor = (stepRank: number): StepStatus => {
    if (phase === 'error') {
      // Steps before the failed one succeeded; the failed step carries the
      // marker; later steps never ran.
      if (stepRank < failedStepRank) return 'done';
      if (stepRank === failedStepRank) return 'error';
      return 'pending';
    }
    if (phase === 'done') return 'done';
    if (rank > stepRank) return 'done';
    if (rank === stepRank) return 'active';
    return 'pending';
  };

  const steps: Array<{ key: string; label: string; status: StepStatus }> = [
    {
      key: 'download',
      label: t('input.autoRunStepDownload', 'Download'),
      status: statusFor(0),
    },
    {
      key: 'transcribe',
      label: t('input.autoRunStepTranscribe', 'Transcribe'),
      status: statusFor(1),
    },
  ];
  if (target === 'translate') {
    steps.push({
      key: 'translate',
      label: t('input.autoRunStepTranslate', 'Translate to {{language}}', {
        language: resolveLanguageLabel(language, t),
      }),
      status: statusFor(2),
    });
  }

  return (
    <div className={shellStyles} role="status" aria-live="polite">
      <div className={stepsRowStyles}>
        {steps.map((step, index) => (
          <span key={step.key} className={stepStyles}>
            {index > 0 ? (
              <span className={connectorStyles} aria-hidden="true">
                <ChevronRight size={15} strokeWidth={2.4} />
              </span>
            ) : null}
            <StepIcon status={step.status} />
            <span className={labelByStatusStyles[step.status]}>
              {step.label}
            </span>
          </span>
        ))}
      </div>
      <button
        type="button"
        className={dismissButtonStyles}
        onClick={onDismiss}
        aria-label={t('common.dismiss', 'Dismiss')}
      >
        <X size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}
