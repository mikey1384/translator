import type { TFunction } from 'i18next';
import Button from '../../../../components/Button.js';
import {
  cardActionsStyles,
  cardBodyStyles,
  cardMetaRowStyles,
  cardMoreActionsStyles,
  cardStyles,
  detailsSummaryStyles,
  emptyTabStateStyles,
  historyActionsStyles,
  historyCardsStyles,
  historySectionStyles,
  historyTitleStyles,
  metaStyles,
  thumbnailStyles,
  titleStyles,
} from './VideoSuggestionPanel.styles.js';
import type { VideoSuggestionDownloadHistoryItem } from './VideoSuggestionPanel.types.js';
import type { VideoSuggestionResultItem } from '@shared-types/app';

type VideoSuggestionHistoryTabProps = {
  disabled: boolean;
  downloadHistory: VideoSuggestionDownloadHistoryItem[];
  isDownloadInProgress: boolean;
  localPrimaryActionLabel: string;
  playablePathMap: Record<string, boolean>;
  t: TFunction;
  buildVideoMetaDetails: (item: VideoSuggestionResultItem) => string[];
  formatHistoryTimestamp: (iso: string) => string;
  onOpenChannelExternally: (channelUrl?: string, channelName?: string) => void;
  onOpenDownloadedVideo: (item: VideoSuggestionDownloadHistoryItem) => void;
  onOpenVideoExternally: (url: string) => void;
  onRedownloadHistoryItem: (item: VideoSuggestionDownloadHistoryItem) => void;
  onRemoveHistoryItem: (id: string) => void;
};

export default function VideoSuggestionHistoryTab({
  disabled,
  downloadHistory,
  isDownloadInProgress,
  localPrimaryActionLabel,
  playablePathMap,
  t,
  buildVideoMetaDetails,
  formatHistoryTimestamp,
  onOpenChannelExternally,
  onOpenDownloadedVideo,
  onOpenVideoExternally,
  onRedownloadHistoryItem,
  onRemoveHistoryItem,
}: VideoSuggestionHistoryTabProps) {
  if (downloadHistory.length === 0) {
    return (
      <div className={emptyTabStateStyles}>
        {t('input.videoSuggestion.historyEmpty', 'No downloaded videos yet.')}
      </div>
    );
  }

  return (
    <div className={historySectionStyles}>
      <div className={historyTitleStyles}>
        {t('input.videoSuggestion.downloadHistoryTitle', 'Download history')}
      </div>
      <div className={historyCardsStyles}>
        {downloadHistory.map(item => {
          const historyMeta = buildVideoMetaDetails({
            id: item.id,
            title: item.title,
            url: item.sourceUrl,
            thumbnailUrl: item.thumbnailUrl,
            channel: item.channel,
            durationSec: item.durationSec,
            uploadedAt: item.uploadedAt,
          });
          const downloadedAt = formatHistoryTimestamp(item.downloadedAtIso);
          const canPlay =
            Boolean(item.localPath) && playablePathMap[item.id] === true;

          return (
            <div key={`history-${item.id}`} className={cardStyles}>
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
                    t('input.videoSuggestion.untitledVideo', 'Untitled video')}
                </div>
                {item.channel ? (
                  <div className={metaStyles}>{item.channel}</div>
                ) : null}
                <div className={cardMetaRowStyles}>
                  {downloadedAt
                    ? t(
                        'input.videoSuggestion.downloadedOn',
                        'Downloaded {{date}}',
                        {
                          date: downloadedAt,
                        }
                      )
                    : t(
                        'input.videoSuggestion.downloadedRecently',
                        'Downloaded recently'
                      )}
                </div>
                {historyMeta.length > 0 ? (
                  <div className={cardMetaRowStyles}>
                    {historyMeta.join(' • ')}
                  </div>
                ) : null}
                <div className={cardActionsStyles}>
                  {canPlay ? (
                    <Button
                      onClick={() => onOpenDownloadedVideo(item)}
                      disabled={disabled || !canPlay}
                      size="sm"
                      variant="primary"
                      fullWidth
                    >
                      {localPrimaryActionLabel}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => onRedownloadHistoryItem(item)}
                      disabled={disabled || isDownloadInProgress}
                      size="sm"
                      variant="primary"
                      fullWidth
                    >
                      {isDownloadInProgress
                        ? t('input.downloading', 'Downloading...')
                        : t(
                            'input.videoSuggestion.downloadAgain',
                            'Download again'
                          )}
                    </Button>
                  )}

                  <details className={cardMoreActionsStyles}>
                    <summary className={detailsSummaryStyles}>
                      {t('input.videoSuggestion.moreActions', 'More actions')}
                    </summary>
                    <div className={historyActionsStyles}>
                      {canPlay ? (
                        <Button
                          onClick={() => onRedownloadHistoryItem(item)}
                          disabled={disabled || isDownloadInProgress}
                          size="sm"
                          variant="secondary"
                          fullWidth
                        >
                          {isDownloadInProgress
                            ? t('input.downloading', 'Downloading...')
                            : t(
                                'input.videoSuggestion.downloadAgain',
                                'Download again'
                              )}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => onOpenDownloadedVideo(item)}
                          disabled={disabled || !canPlay}
                          size="sm"
                          variant="secondary"
                          fullWidth
                        >
                          {localPrimaryActionLabel}
                        </Button>
                      )}
                      <Button
                        onClick={() => onOpenVideoExternally(item.sourceUrl)}
                        disabled={disabled}
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
                          onOpenChannelExternally(item.channelUrl, item.channel)
                        }
                        disabled={
                          disabled || (!item.channelUrl && !item.channel)
                        }
                        size="sm"
                        variant="secondary"
                        fullWidth
                      >
                        {t('input.videoSuggestion.openChannel', 'Open channel')}
                      </Button>
                      <Button
                        onClick={() => onRemoveHistoryItem(item.id)}
                        disabled={disabled}
                        size="sm"
                        variant="danger"
                        fullWidth
                      >
                        {t('input.videoSuggestion.removeHistoryItem', 'Remove')}
                      </Button>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
