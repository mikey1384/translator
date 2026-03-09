import type { TFunction } from 'i18next';
import Button from '../../../../components/Button.js';
import IconButton from '../../../../components/IconButton.js';
import {
  Download,
  ExternalLink,
  Play,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  cardActionsStyles,
  cardBodyStyles,
  cardMetaRowStyles,
  cardMoreActionsStyles,
  cardStyles,
  detailsSummaryStyles,
  emptyTabStateStyles,
  historyActionIconRowStyles,
  historyActionsStyles,
  historyCardsStyles,
  historySectionStyles,
  historyStatusPillStyles,
  historyStatusSavedPillStyles,
  historyStatusTempPillStyles,
  historyTitleStyles,
  metaStyles,
  thumbnailStyles,
  titleStyles,
} from './VideoSuggestionPanel.styles.js';
import type { VideoSuggestionDownloadHistoryItem } from './VideoSuggestionPanel.types.js';
import type { VideoSuggestionResultItem } from '@shared-types/app';
import { getVideoSuggestionHistoryStorageKind } from './video-suggestion-local-storage.js';

type VideoSuggestionHistoryTabProps = {
  disabled: boolean;
  downloadHistory: VideoSuggestionDownloadHistoryItem[];
  isDownloadInProgress: boolean;
  isTranslationInProgress: boolean;
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
  isTranslationInProgress,
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
          const storageKind = getVideoSuggestionHistoryStorageKind(
            item.localPath
          );

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
                {storageKind !== 'unknown' && canPlay ? (
                  <div className={cardMetaRowStyles}>
                    {storageKind === 'saved' ? (
                      <span className={historyStatusSavedPillStyles}>
                        {t(
                          'input.videoSuggestion.savedToFolder',
                          'Saved to your folder'
                        )}
                      </span>
                    ) : null}
                    {storageKind !== 'saved' ? (
                      <span className={historyStatusTempPillStyles}>
                        {t(
                          'input.videoSuggestion.tempFileAvailable',
                          'Temp copy still available'
                        )}
                      </span>
                    ) : null}
                    {canPlay ? (
                      <span className={historyStatusPillStyles}>
                        {t(
                          'input.videoSuggestion.localFileAvailable',
                          'File available'
                        )}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {historyMeta.length > 0 ? (
                  <div className={cardMetaRowStyles}>
                    {historyMeta.join(' • ')}
                  </div>
                ) : null}
                <div className={cardActionsStyles}>
                  {canPlay ? (
                    <Button
                      onClick={() => onOpenDownloadedVideo(item)}
                      disabled={isTranslationInProgress || !canPlay}
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
                    <div className={historyActionIconRowStyles}>
                      {canPlay ? (
                        <IconButton
                          onClick={() => onRedownloadHistoryItem(item)}
                          disabled={disabled || isDownloadInProgress}
                          variant="secondary"
                          size="sm"
                          icon={<Download size={16} />}
                          title={t(
                            'input.videoSuggestion.downloadAgain',
                            'Download again'
                          )}
                          aria-label={t(
                            'input.videoSuggestion.downloadAgain',
                            'Download again'
                          )}
                        >
                        </IconButton>
                      ) : (
                        <IconButton
                          onClick={() => onOpenDownloadedVideo(item)}
                          disabled={isTranslationInProgress || !canPlay}
                          variant="secondary"
                          size="sm"
                          icon={<Play size={16} />}
                          title={localPrimaryActionLabel}
                          aria-label={localPrimaryActionLabel}
                        >
                        </IconButton>
                      )}
                      <IconButton
                        onClick={() => onOpenVideoExternally(item.sourceUrl)}
                        variant="secondary"
                        size="sm"
                        icon={<ExternalLink size={16} />}
                        title={t(
                          'input.videoSuggestion.openOnYoutube',
                          'Open on YouTube'
                        )}
                        aria-label={t(
                          'input.videoSuggestion.openOnYoutube',
                          'Open on YouTube'
                        )}
                      >
                      </IconButton>
                      <IconButton
                        onClick={() =>
                          onOpenChannelExternally(item.channelUrl, item.channel)
                        }
                        disabled={!item.channelUrl && !item.channel}
                        variant="secondary"
                        size="sm"
                        icon={<UserRound size={16} />}
                        title={t(
                          'input.videoSuggestion.openChannel',
                          'Open channel'
                        )}
                        aria-label={t(
                          'input.videoSuggestion.openChannel',
                          'Open channel'
                        )}
                      >
                      </IconButton>
                      <IconButton
                        onClick={() => onRemoveHistoryItem(item.id)}
                        size="sm"
                        variant="secondary"
                        icon={<Trash2 size={16} />}
                        title={t(
                          'input.videoSuggestion.removeHistoryItem',
                          'Remove'
                        )}
                        aria-label={t(
                          'input.videoSuggestion.removeHistoryItem',
                          'Remove'
                        )}
                      >
                      </IconButton>
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
