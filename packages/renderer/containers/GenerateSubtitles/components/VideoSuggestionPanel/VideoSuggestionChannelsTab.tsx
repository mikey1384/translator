import type { TFunction } from 'i18next';
import Button from '../../../../components/Button.js';
import {
  channelQuickActionRowStyles,
  channelQuickActionsStyles,
  emptyTabStateStyles,
  historySectionStyles,
  historyTitleStyles,
} from './VideoSuggestionPanel.styles.js';

type RecentDownloadedChannel = {
  key: string;
  name: string;
  channelUrl?: string;
  downloadedAtIso: string;
};

type VideoSuggestionChannelsTabProps = {
  disabled: boolean;
  recentDownloadedChannels: RecentDownloadedChannel[];
  t: TFunction;
  onOpenChannelExternally: (channelUrl?: string, channelName?: string) => void;
  onRemoveChannelItem: (key: string) => void;
};

export default function VideoSuggestionChannelsTab({
  disabled,
  recentDownloadedChannels,
  t,
  onOpenChannelExternally,
  onRemoveChannelItem,
}: VideoSuggestionChannelsTabProps) {
  if (recentDownloadedChannels.length === 0) {
    return (
      <div className={emptyTabStateStyles}>
        {t(
          'input.videoSuggestion.channelsEmpty',
          'No channel shortcuts yet. Download a recommended video first.'
        )}
      </div>
    );
  }

  return (
    <div className={historySectionStyles}>
      <div className={historyTitleStyles}>
        {t(
          'input.videoSuggestion.recentChannelsTitle',
          'Recent downloaded channels'
        )}
      </div>
      <div className={channelQuickActionsStyles}>
        {recentDownloadedChannels.map(channel => (
          <div key={channel.key} className={channelQuickActionRowStyles}>
            <Button
              onClick={() =>
                onOpenChannelExternally(channel.channelUrl, channel.name)
              }
              disabled={disabled}
              size="sm"
              variant="secondary"
              fullWidth
            >
              {channel.name}
            </Button>
            <Button
              onClick={() => onRemoveChannelItem(channel.key)}
              disabled={disabled}
              size="sm"
              variant="danger"
            >
              {t('input.videoSuggestion.removeChannelItem', 'Remove channel')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
