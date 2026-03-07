import type { TFunction } from 'i18next';
import Button from '../Button';
import {
  summaryBoxStyles,
  summaryHeaderStyles,
} from './TranscriptSummaryPanel.styles';

type TranscriptSummarySummaryTabProps = {
  copyStatus: 'idle' | 'copied';
  onCopy: () => void;
  summary: string;
  t: TFunction;
};

export default function TranscriptSummarySummaryTab({
  copyStatus,
  onCopy,
  summary,
  t,
}: TranscriptSummarySummaryTabProps) {
  if (!summary) return null;

  return (
    <>
      <div className={summaryHeaderStyles}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCopy}
          disabled={!summary}
        >
          {copyStatus === 'copied' ? t('summary.copied') : t('summary.copy')}
        </Button>
      </div>
      <div className={summaryBoxStyles}>
        <pre>{summary}</pre>
      </div>
    </>
  );
}
