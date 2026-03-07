import type { TFunction } from 'i18next';
import type { TranscriptSummarySection } from '@shared-types/app';
import {
  noHighlightsStyles,
  sectionCardStyles,
  sectionContentStyles,
  sectionHeaderStyles,
  sectionIndexStyles,
  sectionParagraphStyles,
  sectionTitleStyles,
  sectionsListStyles,
} from './TranscriptSummaryPanel.styles';

type TranscriptSummarySectionsTabProps = {
  sections: TranscriptSummarySection[];
  t: TFunction;
};

export default function TranscriptSummarySectionsTab({
  sections,
  t,
}: TranscriptSummarySectionsTabProps) {
  return (
    <div className={sectionsListStyles}>
      {sections.length === 0 ? (
        <div className={noHighlightsStyles}>
          {t('summary.noSections', 'No section notes yet.')}
        </div>
      ) : (
        sections.map(section => {
          const paragraphs: string[] = section.content
            .split(/\n{2,}/)
            .map(part => part.trim())
            .filter(part => part.length > 0);

          return (
            <div key={section.index} className={sectionCardStyles}>
              <div className={sectionHeaderStyles}>
                <span className={sectionIndexStyles}>
                  {t('summary.sectionHeading', {
                    index: section.index,
                  })}
                </span>
                <span className={sectionTitleStyles}>{section.title}</span>
              </div>
              <div className={sectionContentStyles}>
                {paragraphs.length === 0 ? (
                  <p className={sectionParagraphStyles}>{section.content}</p>
                ) : (
                  paragraphs.map((paragraph, idx) => (
                    <p key={idx} className={sectionParagraphStyles}>
                      {paragraph}
                    </p>
                  ))
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
