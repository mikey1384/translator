import type { TFunction } from 'i18next';
import Button from '../../../../components/Button.js';
import {
  cardActionsStyles,
  cardBodyStyles,
  cardMetaRowStyles,
  cardMoreActionsStyles,
  cardSecondaryActionsStyles,
  cardStyles,
  cardsStyles,
  detailsSummaryStyles,
  liveActivityMetaStyles,
  metaStyles,
  moreActionsStyles,
  moreActionsProgressMetaStyles,
  moreActionsProgressStyles,
  resultsEmptyTabStateStyles,
  resultsHeaderStyles,
  stageProgressFillStyles,
  stageProgressTrackStyles,
  thumbnailStyles,
  titleStyles,
} from './VideoSuggestionPanel.styles.js';
import type { VideoSuggestionResultItem } from '@shared-types/app';
import type { PipelineStageProgress } from './VideoSuggestionPanel.types.js';

const LOCAL_PROGRESS_MIN = 7;
const LOCAL_PROGRESS_MAX = 95;
const LOCAL_PROGRESS_EASE_SEC = 28;

function getLocalProgressPercent(
  loadingElapsedSec: number,
  hasRunningStage: boolean
): number {
  if (!hasRunningStage) return 12;
  const safeElapsed = Math.max(0, loadingElapsedSec);
  const eased = 1 - Math.exp(-safeElapsed / LOCAL_PROGRESS_EASE_SEC);
  return (
    LOCAL_PROGRESS_MIN +
    (LOCAL_PROGRESS_MAX - LOCAL_PROGRESS_MIN) * eased
  );
}

type VideoSuggestionResultsTabProps = {
  disabled: boolean;
  loadingElapsedSec: number;
  loadingMessage: string;
  primaryActionLabel: string;
  isDownloadInProgress: boolean;
  loading: boolean;
  loadingMode: 'chat' | 'more' | null;
  runningStage: PipelineStageProgress | null;
  results: VideoSuggestionResultItem[];
  searchQuery: string;
  t: TFunction;
  buildVideoMetaDetails: (item: VideoSuggestionResultItem) => string[];
  onDownloadFromSuggestion: (item: VideoSuggestionResultItem) => void;
  onOpenChannelExternally: (channelUrl?: string, channelName?: string) => void;
  onOpenVideoExternally: (url: string) => void;
  onSearchMore: () => void;
};

export default function VideoSuggestionResultsTab({
  disabled,
  loadingElapsedSec,
  loadingMessage,
  primaryActionLabel,
  isDownloadInProgress,
  loading,
  loadingMode,
  runningStage,
  results,
  searchQuery,
  t,
  buildVideoMetaDetails,
  onDownloadFromSuggestion,
  onOpenChannelExternally,
  onOpenVideoExternally,
  onSearchMore,
}: VideoSuggestionResultsTabProps) {
  const showInlineSearchMoreProgress = loading && loadingMode === 'more';
  const localProgressPercent = getLocalProgressPercent(
    loadingElapsedSec,
    Boolean(runningStage)
  );

  return (
    <>
      {searchQuery ? (
        <div className={resultsHeaderStyles}>
          {t('input.videoSuggestion.searchQueryLabel', 'Search query')}:&nbsp;
          &quot;{searchQuery}&quot;
        </div>
      ) : null}

      {results.length > 0 ? (
        <>
          <div className={resultsHeaderStyles}>
            {t(
              'input.videoSuggestion.nextActionHint',
              'Pick a video, then download it or open it on YouTube.'
            )}
          </div>
          <div className={cardsStyles}>
            {results.map(item => {
              const extraMeta = buildVideoMetaDetails(item);
              return (
                <div key={item.id + item.url} className={cardStyles}>
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      className={thumbnailStyles}
                      loading="lazy"
                    />
                  ) : (
                    <div className={thumbnailStyles} />
                  )}
                  <div className={cardBodyStyles}>
                    <div className={titleStyles}>
                      {item.title ||
                        t(
                          'input.videoSuggestion.untitledVideo',
                          'Untitled video'
                        )}
                    </div>
                    {item.channel ? (
                      <div className={metaStyles}>{item.channel}</div>
                    ) : null}
                    {extraMeta.length > 0 ? (
                      <div className={cardMetaRowStyles}>
                        {extraMeta.join(' • ')}
                      </div>
                    ) : null}
                    <div className={cardActionsStyles}>
                      <Button
                        onClick={() => onDownloadFromSuggestion(item)}
                        disabled={disabled || isDownloadInProgress}
                        size="sm"
                        variant="primary"
                        fullWidth
                      >
                        {isDownloadInProgress
                          ? t('input.downloading', 'Downloading...')
                          : primaryActionLabel}
                      </Button>
                      <details className={cardMoreActionsStyles}>
                        <summary className={detailsSummaryStyles}>
                          {t(
                            'input.videoSuggestion.moreActions',
                            'More actions'
                          )}
                        </summary>
                        <div className={cardSecondaryActionsStyles}>
                          <Button
                            onClick={() => onOpenVideoExternally(item.url)}
                            size="sm"
                            variant="secondary"
                            fullWidth
                          >
                            {t(
                              'input.videoSuggestion.openOnYoutube',
                              'Open on YouTube'
                            )}
                          </Button>
                          <Button
                            onClick={() =>
                              onOpenChannelExternally(
                                item.channelUrl,
                                item.channel
                              )
                            }
                            disabled={!item.channelUrl && !item.channel}
                            size="sm"
                            variant="secondary"
                            fullWidth
                          >
                            {t(
                              'input.videoSuggestion.openChannel',
                              'Open channel'
                            )}
                          </Button>
                        </div>
                      </details>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={moreActionsStyles}>
            {showInlineSearchMoreProgress ? (
              <div className={moreActionsProgressStyles}>
                <div className={moreActionsProgressMetaStyles}>
                  <span className={liveActivityMetaStyles}>
                    {loadingMessage ||
                      t(
                        'input.videoSuggestion.searchMoreLoading',
                        'Searching more...'
                      )}
                  </span>
                  <span className={liveActivityMetaStyles}>
                    {loadingElapsedSec}s
                  </span>
                </div>
                <div className={stageProgressTrackStyles} aria-hidden="true">
                  <div
                    className={stageProgressFillStyles}
                    style={{ width: `${localProgressPercent}%` }}
                  />
                </div>
              </div>
            ) : null}
            <Button
              onClick={() => onSearchMore()}
              disabled={loading || !searchQuery.trim()}
              size="sm"
              variant="secondary"
            >
              {loadingMode === 'more'
                ? t(
                    'input.videoSuggestion.searchMoreLoading',
                    'Searching more...'
                  )
                : t('input.videoSuggestion.searchMore', 'Search more')}
            </Button>
          </div>
        </>
      ) : (
        <div className={resultsEmptyTabStateStyles}>
          {t(
            'input.videoSuggestion.resultsEmpty',
            'No results yet. Ask for a video and I will search.'
          )}
        </div>
      )}
    </>
  );
}
