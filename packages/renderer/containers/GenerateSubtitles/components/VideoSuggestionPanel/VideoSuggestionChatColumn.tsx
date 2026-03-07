import type { KeyboardEvent } from 'react';
import { cx } from '@emotion/css';
import type { TFunction } from 'i18next';
import Button from '../../../../components/Button.js';
import {
  assistantBubbleStyles,
  chatColumnStyles,
  chatColumnCompactStyles,
  chatEmptyCopyStyles,
  chatEmptyEyebrowStyles,
  chatEmptyStateStyles,
  chatEmptyTitleStyles,
  composerHeaderStyles,
  composerHintPillStyles,
  composerMetaStyles,
  composerSurfaceStyles,
  composerTitleStyles,
  inputFieldStyles,
  inputFooterStyles,
  inputActionsStyles,
  inputWrapStyles,
  loadingMetaStyles,
  messagesStyles,
  messagesCompactStyles,
  userBubbleStyles,
} from './VideoSuggestionPanel.styles.js';
import type {
  PipelineStageKey,
  PipelineStageProgress,
} from './VideoSuggestionPanel.types.js';
import type { VideoSuggestionMessage } from '@shared-types/app';

type VideoSuggestionChatColumnProps = {
  cancelling: boolean;
  compact: boolean;
  disabled: boolean;
  loading: boolean;
  input: string;
  messages: VideoSuggestionMessage[];
  loadingElapsedSec: number;
  loadingMessage: string;
  runningStage: PipelineStageProgress | null;
  streamingPreview: string;
  t: TFunction;
  onInputChange: (value: string) => void;
  onInputCompositionStart: () => void;
  onInputCompositionEnd: () => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancelSearch: () => void;
  onResetChat: () => void;
  onSend: () => void;
  onUseQuickStart: () => void;
  resetDisabled: boolean;
  showQuickStartAction: boolean;
  resolveI18n: (text: string) => string;
  pipelineStageLabel: (key: PipelineStageKey) => string;
};

export default function VideoSuggestionChatColumn({
  cancelling,
  compact,
  disabled,
  loading,
  input,
  messages,
  loadingElapsedSec,
  loadingMessage,
  runningStage,
  streamingPreview,
  t,
  onInputChange,
  onInputCompositionStart,
  onInputCompositionEnd,
  onInputKeyDown,
  onCancelSearch,
  onResetChat,
  onSend,
  onUseQuickStart,
  resetDisabled,
  showQuickStartAction,
  resolveI18n,
  pipelineStageLabel,
}: VideoSuggestionChatColumnProps) {
  return (
    <div className={cx(chatColumnStyles, compact && chatColumnCompactStyles)}>
      <div className={cx(messagesStyles, compact && messagesCompactStyles)}>
        {messages.length === 0 && !loading ? (
          <div className={chatEmptyStateStyles}>
            <div className={chatEmptyEyebrowStyles}>
              {t(
                'input.videoSuggestion.emptyEyebrow',
                'Assistant-guided discovery'
              )}
            </div>
            <div className={chatEmptyTitleStyles}>
              {t(
                'input.videoSuggestion.emptyTitle',
                'Describe the video you want to source'
              )}
            </div>
            <div className={chatEmptyCopyStyles}>
              {t(
                'input.videoSuggestion.emptyCopy',
                'Mention a topic, audience, creator style, or mood. Add country or recency only when it matters.'
              )}
            </div>
          </div>
        ) : null}
        {messages.map((msg, idx) => (
          <div
            key={`${msg.role}-${idx}-${msg.content.slice(0, 12)}`}
            className={
              msg.role === 'assistant'
                ? assistantBubbleStyles
                : userBubbleStyles
            }
          >
            {resolveI18n(msg.content)}
          </div>
        ))}
        {loading ? (
          <div className={assistantBubbleStyles}>
            <div>{loadingMessage}</div>
            {runningStage ? (
              <div className={loadingMetaStyles}>
                {t('input.videoSuggestion.currentStep', 'Current step')}:{' '}
                {runningStage.index}. {pipelineStageLabel(runningStage.key)}
              </div>
            ) : null}
            {streamingPreview.trim() ? (
              <div className={loadingMetaStyles}>{streamingPreview}</div>
            ) : loadingElapsedSec >= 8 ? (
              <div className={loadingMetaStyles}>
                {t('input.videoSuggestion.stillRunning', 'Still running')}
                {` • ${loadingElapsedSec}s`}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={inputWrapStyles}>
        <div className={composerHeaderStyles}>
          <div className={composerTitleStyles}>
            {t('input.videoSuggestion.composerTitle', 'Tell AI what to find')}
          </div>
          <div className={composerHintPillStyles}>
            {t('input.videoSuggestion.composerHint', 'Any language')}
          </div>
        </div>
        <div className={composerSurfaceStyles}>
          <textarea
            value={input}
            onChange={event => onInputChange(event.target.value)}
            onCompositionStart={onInputCompositionStart}
            onCompositionEnd={onInputCompositionEnd}
            onKeyDown={onInputKeyDown}
            placeholder={t(
              'input.videoSuggestion.placeholder',
              'e.g. street interviews about AI policy'
            )}
            className={inputFieldStyles}
            disabled={disabled || loading}
            rows={3}
          />
          <div className={inputFooterStyles}>
            <div className={composerMetaStyles}>
              {t('input.videoSuggestion.composerMeta', 'Press Enter to search')}
            </div>
            <div className={inputActionsStyles}>
              {showQuickStartAction ? (
                <Button
                  onClick={() => onUseQuickStart()}
                  disabled={disabled || loading}
                  size="sm"
                  variant="secondary"
                >
                  {t(
                    'input.videoSuggestion.useLastSearch',
                    'Search like last time'
                  )}
                </Button>
              ) : null}
              <Button
                onClick={() => onSend()}
                disabled={!input.trim() || disabled || loading}
                size="sm"
                variant="primary"
              >
                {t('input.videoSuggestion.findVideos', 'Find videos')}
              </Button>
              <Button
                onClick={() => {
                  if (loading) onCancelSearch();
                  else onResetChat();
                }}
                disabled={
                  loading ? disabled || cancelling : resetDisabled || disabled
                }
                size="sm"
                variant="text"
              >
                {loading
                  ? t('common.cancel', 'Cancel')
                  : t('input.videoSuggestion.resetChat', 'Reset chat')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
