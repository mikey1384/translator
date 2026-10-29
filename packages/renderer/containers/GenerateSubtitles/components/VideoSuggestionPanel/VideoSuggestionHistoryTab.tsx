import { useDownloadFolders } from './DownloadHistoryFolders';
import VideoCostLine from '../../../../components/VideoCostLine';
import type { TFunction } from 'i18next';
import Button from '../../../../components/Button.js';
import IconButton from '../../../../components/IconButton.js';
import {
  Download,
  ExternalLink,
  FileX2,
  ListX,
  Play,
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
  metaStyles,
  thumbnailStyles,
  titleStyles,
} from './VideoSuggestionPanel.styles.js';
import type { VideoSuggestionDownloadHistoryItem } from './VideoSuggestionPanel.types.js';
import type { VideoSuggestionResultItem } from '@shared-types/app';
import { getVideoSuggestionHistoryStorageKind } from './video-suggestion-local-storage.js';
import {
  canDeleteDownloadHistoryFile,
  historyRemovalDeletesManagedFile,
} from './download-history-actions.js';
import { youtubeVideoIdFromUrl } from '../../../../../shared/helpers/video-url.js';
import { useVideoStore } from '../../../../state/video-store.js';
import { openNotice } from '../../../../state/modal-store.js';

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
  onDeleteHistoryFile: (item: VideoSuggestionDownloadHistoryItem) => void;
  onDeleteHistoryFileAndHistory: (
    item: VideoSuggestionDownloadHistoryItem
  ) => void;
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
  onDeleteHistoryFile,
  onDeleteHistoryFileAndHistory,
  onRemoveHistoryItem,
}: VideoSuggestionHistoryTabProps) {
  const folders = useDownloadFolders(t, downloadHistory);
  // Name the site the video came from; not every download is from YouTube.
  const openSourceLabel = (url: string) =>
    youtubeVideoIdFromUrl(url)
      ? t('input.videoSuggestion.openOnYoutube', 'Open on YouTube')
      : t('input.videoSuggestion.openOriginalPage', 'Open original page');

  // The open video's file can't be deleted; say so before asking to confirm.
  const openPath = useVideoStore(s => s.originalPath || s.path);
  const isOpenNow = (item: VideoSuggestionDownloadHistoryItem) =>
    Boolean(item.localPath && openPath && item.localPath === openPath);
  const explainInUse = () =>
    openNotice({
      title: t(
        'input.videoSuggestion.deleteLocalFile',
        'Delete file from device'
      ),
      message: t(
        'input.videoSuggestion.deleteLocalFileInUse',
        'This video is currently open. Open another video before deleting it.'
      ),
      buttons: [{ id: 'ok', label: t('common.ok', 'OK'), variant: 'primary' }],
    });
  const confirmDanger = async (title: string, message: string) =>
    (await openNotice({
      title,
      message,
      buttons: [
        { id: 'cancel', label: t('common.cancel', 'Cancel') },
        { id: 'confirm', label: title, variant: 'danger' },
      ],
    })) === 'confirm';

  return (
    <div className={historySectionStyles}>
      {folders.controls}
      {!folders.privateSelected && !folders.visibleItems.length && (
        <div className={emptyTabStateStyles}>
          {t('input.videoSuggestion.historyEmpty', 'No downloaded videos yet.')}
        </div>
      )}
      <div className={historyCardsStyles}>
        {!folders.privateSelected &&
          folders.visibleItems.map(item => {
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
              item.localPath,
              item.managedLocalFile
            );
            const canDeleteLocalFile = canDeleteDownloadHistoryFile({
              managedLocalFile: item.managedLocalFile === true,
              canPlay,
            });
            const removeDeletesManagedFile = historyRemovalDeletesManagedFile(
              item.managedLocalFile === true
            );
            const removeHistoryLabel = removeDeletesManagedFile
              ? t(
                  'input.videoSuggestion.deleteFileAndHistory',
                  'Delete file and history'
                )
              : t(
                  'input.videoSuggestion.removeFromHistory',
                  'Remove from history'
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
                      t(
                        'input.videoSuggestion.untitledVideo',
                        'Untitled video'
                      )}
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
                      {[
                        storageKind === 'saved'
                          ? t(
                              'input.videoSuggestion.savedToFolder',
                              'Saved to your folder'
                            )
                          : storageKind === 'library'
                            ? t(
                                'input.videoSuggestion.storedInAppLibrary',
                                'Stored in app library'
                              )
                            : storageKind === 'temp'
                              ? t(
                                  'input.videoSuggestion.tempFileAvailable',
                                  'Temp copy still available'
                                )
                              : null,
                        t(
                          'input.videoSuggestion.localFileAvailable',
                          'File available'
                        ),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  ) : null}
                  {historyMeta.length > 0 ? (
                    <div className={cardMetaRowStyles}>
                      {historyMeta.join(' • ')}
                    </div>
                  ) : null}
                  <VideoCostLine durationSec={item.durationSec} />
                  <div className={cardActionsStyles}>
                    {canPlay ? (
                      <Button
                        onClick={() => onOpenDownloadedVideo(item)}
                        disabled={isTranslationInProgress || !canPlay}
                        size="sm"
                        variant="secondary"
                        leftIcon={<Play size={15} aria-hidden="true" />}
                        fullWidth
                      >
                        {localPrimaryActionLabel}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => onRedownloadHistoryItem(item)}
                        disabled={disabled || isDownloadInProgress}
                        size="sm"
                        variant="secondary"
                        leftIcon={<Download size={15} aria-hidden="true" />}
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
                        <IconButton
                          onClick={() => onOpenVideoExternally(item.sourceUrl)}
                          variant="secondary"
                          size="sm"
                          icon={<ExternalLink size={16} />}
                          title={openSourceLabel(item.sourceUrl)}
                          aria-label={openSourceLabel(item.sourceUrl)}
                        ></IconButton>
                        <IconButton
                          onClick={() =>
                            onOpenChannelExternally(
                              item.channelUrl,
                              item.channel
                            )
                          }
                          // Without a channel link, only YouTube can be
                          // searched by channel name.
                          disabled={
                            !item.channelUrl &&
                            (!item.channel ||
                              !youtubeVideoIdFromUrl(item.sourceUrl))
                          }
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
                        ></IconButton>
                      </div>
                      <div className={historyActionsStyles}>
                        {folders.moveButton(item)}
                        {canDeleteLocalFile ? (
                          <Button
                            onClick={async () => {
                              if (isOpenNow(item)) {
                                await explainInUse();
                                return;
                              }
                              const confirmed = await confirmDanger(
                                t(
                                  'input.videoSuggestion.deleteLocalFile',
                                  'Delete file from device'
                                ),
                                t(
                                  'input.videoSuggestion.deleteLocalFileConfirm',
                                  'Permanently delete this downloaded file from this device? Its history entry and source link will stay.'
                                )
                              );
                              if (!confirmed) return;
                              onDeleteHistoryFile(item);
                            }}
                            disabled={isTranslationInProgress}
                            size="sm"
                            variant="danger"
                            fullWidth
                            leftIcon={<FileX2 size={16} />}
                          >
                            {t(
                              'input.videoSuggestion.deleteLocalFile',
                              'Delete file from device'
                            )}
                          </Button>
                        ) : null}
                        <Button
                          onClick={async () => {
                            if (removeDeletesManagedFile && isOpenNow(item)) {
                              await explainInUse();
                              return;
                            }
                            const confirmed = await confirmDanger(
                              removeHistoryLabel,
                              removeDeletesManagedFile
                                ? t(
                                    'input.videoSuggestion.deleteFileAndHistoryConfirm',
                                    'Permanently delete this downloaded file and remove its history entry? This cannot be undone.'
                                  )
                                : t(
                                    'input.videoSuggestion.removeFromHistoryConfirm',
                                    'Remove this item from download history? Any file saved outside the app library will stay on your device.'
                                  )
                            );
                            if (!confirmed) return;
                            if (removeDeletesManagedFile) {
                              onDeleteHistoryFileAndHistory(item);
                            } else {
                              onRemoveHistoryItem(item.id);
                            }
                          }}
                          size="sm"
                          variant={
                            removeDeletesManagedFile ? 'danger' : 'secondary'
                          }
                          fullWidth
                          leftIcon={<ListX size={16} />}
                        >
                          {removeHistoryLabel}
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
