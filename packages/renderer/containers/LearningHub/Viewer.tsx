import type { TFunction } from 'i18next';
import type { LearningEntry, SrtSegment } from '@shared-types/app';
import TranscriptList from './TranscriptList';
import type { LanguageKey } from './types';
import {
  emptyStateStyles,
  metaItemStyles,
  metaRowStyles,
  previewVideoStyles,
  viewerStyles,
  warningStyles,
} from './styles';

interface LearningHubViewerProps {
  selectedEntry: LearningEntry | null;
  selectedLanguage: LanguageKey | null;
  transcriptSegments: SrtSegment[];
  srtError: string | null;
  videoMissing: boolean;
  activeVideoUrl: string | null;
  t: TFunction;
}

const resolveLanguageLabel = (
  selectedLanguage: LanguageKey | null,
  t: TFunction
) => {
  if (!selectedLanguage) {
    return null;
  }

  if (selectedLanguage === 'transcript') {
    return t('learningHub.languages.original', 'Original transcript');
  }

  return t('learningHub.languages.translation', '{{lang}} translation', {
    lang: selectedLanguage,
  });
};

export default function LearningHubViewer({
  selectedEntry,
  selectedLanguage,
  transcriptSegments,
  srtError,
  videoMissing,
  activeVideoUrl,
  t,
}: LearningHubViewerProps) {
  const languageLabel = resolveLanguageLabel(selectedLanguage, t);

  return (
    <div className={viewerStyles}>
      {selectedEntry ? (
        <>
          <div className={metaRowStyles}>
            <span className={metaItemStyles}>
              {t('learningHub.viewing', 'Viewing: {{title}}', {
                title: selectedEntry.title,
              })}
            </span>
            {languageLabel && (
              <span className={metaItemStyles}>{languageLabel}</span>
            )}
          </div>
          {srtError && <div className={warningStyles}>{srtError}</div>}
          {videoMissing && (
            <div className={warningStyles}>
              {t(
                'learningHub.videoMissing',
                'The original video could not be found. You can still review the subtitles.'
              )}
            </div>
          )}
          {!videoMissing && activeVideoUrl ? (
            <video
              key={`${selectedEntry.id}-${selectedLanguage ?? 'transcript'}`}
              className={previewVideoStyles}
              controls
              src={activeVideoUrl}
            />
          ) : null}
        </>
      ) : (
        <div className={emptyStateStyles}>
          {t(
            'learningHub.selectPrompt',
            'Select a saved video to review its subtitles and playback.'
          )}
        </div>
      )}

      {selectedEntry && transcriptSegments.length > 0 && (
        <TranscriptList
          segments={transcriptSegments}
          selectedLanguage={selectedLanguage}
        />
      )}
    </div>
  );
}
