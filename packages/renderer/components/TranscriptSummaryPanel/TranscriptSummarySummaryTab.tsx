import type { TFunction } from 'i18next';
import Button from '../Button';
import {
  noHighlightsStyles,
  summaryBoxStyles,
  summaryHeaderStyles,
} from './TranscriptSummaryPanel.styles';

type TranscriptSummarySummaryTabProps = {
  copyStatus: 'idle' | 'copied';
  /** Highlights exist without a summary (e.g. an agent set them). */
  hasOtherResults: boolean;
  isGenerating: boolean;
  onCopy: () => void;
  summary: string;
  t: TFunction;
};

export default function TranscriptSummarySummaryTab({
  copyStatus,
  hasOtherResults,
  isGenerating,
  onCopy,
  summary,
  t,
}: TranscriptSummarySummaryTabProps) {
  if (!summary) {
    if (isGenerating) return null;
    return (
      <div className={noHighlightsStyles}>
        {hasOtherResults
          ? t(
              'summary.noSummaryWithHighlights',
              'These highlights came without a summary. Press Summarize to write one.'
            )
          : t(
              'summary.noSummaryYet',
              'No summary yet. Pick the language and press Summarize to get the main points of this video.'
            )}
      </div>
    );
  }

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
