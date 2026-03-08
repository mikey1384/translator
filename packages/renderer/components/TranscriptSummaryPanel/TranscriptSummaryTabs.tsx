import type { TFunction } from 'i18next';
import {
  tabButtonStyles,
  tabsRowStyles,
} from './TranscriptSummaryPanel.styles';

type SummaryTabKey = 'summary' | 'sections' | 'highlights';

type TranscriptSummaryTabsProps = {
  activeTab: SummaryTabKey;
  onChangeTab: (next: SummaryTabKey) => void;
  t: TFunction;
};

export default function TranscriptSummaryTabs({
  activeTab,
  onChangeTab,
  t,
}: TranscriptSummaryTabsProps) {
  return (
    <div className={tabsRowStyles}>
      <button
        className={tabButtonStyles(activeTab === 'highlights')}
        onClick={() => onChangeTab('highlights')}
      >
        {t('summary.tab.highlights', 'Highlights')}
      </button>
      <button
        className={tabButtonStyles(activeTab === 'summary')}
        onClick={() => onChangeTab('summary')}
      >
        {t('summary.tab.summary', 'Summary')}
      </button>
      <button
        className={tabButtonStyles(activeTab === 'sections')}
        onClick={() => onChangeTab('sections')}
      >
        {t('summary.tab.sections', 'Notes')}
      </button>
    </div>
  );
}
