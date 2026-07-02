import {
  Fragment,
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '@emotion/css';
import type { TFunction } from 'i18next';
import Button from '../../../../components/Button.js';
import {
  assistantBubbleStyles,
  assistantRichTextStyles,
  chatColumnStyles,
  chatColumnCompactStyles,
  chatEmptyCopyStyles,
  chatEmptyEyebrowStyles,
  chatEmptyStateStyles,
  chatEmptyTitleStyles,
  composerHeaderStyles,
  composerMetaStyles,
  composerSurfaceStyles,
  composerTitleStyles,
  inputFieldStyles,
  inputFooterStyles,
  inputActionsStyles,
  suggestedFollowUpButtonStyles,
  suggestedFollowUpsGridStyles,
  suggestedFollowUpsHeaderStyles,
  suggestedFollowUpsStyles,
  inputWrapStyles,
  loadingMetaStyles,
  messagesStyles,
  messagesCompactStyles,
  userBubbleStyles,
} from './VideoSuggestionPanel.styles.js';
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
  suggestedFollowUpPrompts: string[];
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
  onUseSuggestedFollowUp: (prompt: string) => void;
  resetDisabled: boolean;
  showQuickStartAction: boolean;
  resolveI18n: (text: string) => string;
};

function renderAssistantInline(text: string, keyPrefix: string): ReactNode[] {
  return String(text || '')
    .split(/(\*\*[\s\S]+?\*\*)/g)
    .filter(Boolean)
    .map((segment, index) => {
      const boldMatch = segment.match(/^\*\*([\s\S]+)\*\*$/);
      if (boldMatch) {
        return (
          <strong key={`${keyPrefix}-strong-${index}`}>{boldMatch[1]}</strong>
        );
      }

      return <Fragment key={`${keyPrefix}-text-${index}`}>{segment}</Fragment>;
    });
}

function renderAssistantParagraph(
  lines: string[],
  keyPrefix: string
): ReactNode {
  return (
    <p key={`${keyPrefix}-paragraph`}>
      {lines.map((line, index) => (
        <Fragment key={`${keyPrefix}-line-${index}`}>
          {renderAssistantInline(line, `${keyPrefix}-inline-${index}`)}
          {index < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </p>
  );
}

function renderAssistantMessage(content: string): ReactNode {
  const lines = String(content || '')
    .replace(/\r/g, '')
    .split('\n');
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let bulletItems: string[] = [];
  let orderedItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push(
      renderAssistantParagraph(
        paragraphLines,
        `assistant-block-${blocks.length}`
      )
    );
    paragraphLines = [];
  };

  const flushBulletItems = () => {
    if (bulletItems.length === 0) return;
    const keyPrefix = `assistant-block-${blocks.length}`;
    blocks.push(
      <ul key={`${keyPrefix}-ul`}>
        {bulletItems.map((item, index) => (
          <li key={`${keyPrefix}-li-${index}`}>
            {renderAssistantInline(item, `${keyPrefix}-inline-${index}`)}
          </li>
        ))}
      </ul>
    );
    bulletItems = [];
  };

  const flushOrderedItems = () => {
    if (orderedItems.length === 0) return;
    const keyPrefix = `assistant-block-${blocks.length}`;
    blocks.push(
      <ol key={`${keyPrefix}-ol`}>
        {orderedItems.map((item, index) => (
          <li key={`${keyPrefix}-li-${index}`}>
            {renderAssistantInline(item, `${keyPrefix}-inline-${index}`)}
          </li>
        ))}
      </ol>
    );
    orderedItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushBulletItems();
      flushOrderedItems();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      flushOrderedItems();
      bulletItems.push(bulletMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushBulletItems();
      orderedItems.push(orderedMatch[1]);
      continue;
    }

    flushBulletItems();
    flushOrderedItems();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushBulletItems();
  flushOrderedItems();

  if (blocks.length === 0) {
    return content;
  }

  return <div className={assistantRichTextStyles}>{blocks}</div>;
}

export default function VideoSuggestionChatColumn({
  cancelling,
  compact,
  disabled,
  loading,
  input,
  messages,
  loadingElapsedSec,
  loadingMessage,
  suggestedFollowUpPrompts,
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
  onUseSuggestedFollowUp,
  resetDisabled,
  showQuickStartAction,
  resolveI18n,
}: VideoSuggestionChatColumnProps) {
  const [showSuggestedFollowUps, setShowSuggestedFollowUps] = useState(false);
  const canShowSuggestedFollowUps = suggestedFollowUpPrompts.length > 0;

  useEffect(() => {
    if (!canShowSuggestedFollowUps || loading) {
      setShowSuggestedFollowUps(false);
    }
  }, [canShowSuggestedFollowUps, loading]);

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
                'Mention a topic, audience, or mood. Add country or recency only when it matters.'
              )}
            </div>
          </div>
        ) : null}
        {messages.map((msg, idx) =>
          (() => {
            const resolvedContent = resolveI18n(msg.content);
            return (
              <div
                key={`${msg.role}-${idx}-${msg.content.slice(0, 12)}`}
                className={
                  msg.role === 'assistant'
                    ? assistantBubbleStyles
                    : userBubbleStyles
                }
              >
                {msg.role === 'assistant'
                  ? renderAssistantMessage(resolvedContent)
                  : resolvedContent}
              </div>
            );
          })()
        )}
        {loading ? (
          <div className={assistantBubbleStyles}>
            <div>{loadingMessage}</div>
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
                  disabled={loading}
                  size="sm"
                  variant="secondary"
                >
                  {t(
                    'input.videoSuggestion.useLastSearch',
                    'Search like last time'
                  )}
                </Button>
              ) : null}
              {canShowSuggestedFollowUps ? (
                <Button
                  onClick={() => setShowSuggestedFollowUps(current => !current)}
                  disabled={loading}
                  size="sm"
                  variant="secondary"
                >
                  {showSuggestedFollowUps
                    ? t(
                        'input.videoSuggestion.hideFollowUps',
                        'Hide follow-ups'
                      )
                    : t(
                        'input.videoSuggestion.showFollowUps',
                        'Suggested follow-ups'
                      )}
                </Button>
              ) : null}
              <Button
                onClick={() => onSend()}
                disabled={disabled || loading}
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
                disabled={loading ? cancelling : resetDisabled}
                size="sm"
                variant="text"
              >
                {loading
                  ? t('common.cancel', 'Cancel')
                  : t('input.videoSuggestion.resetChat', 'Reset chat')}
              </Button>
            </div>
          </div>
          {showSuggestedFollowUps ? (
            <div className={suggestedFollowUpsStyles}>
              <div className={suggestedFollowUpsHeaderStyles}>
                {t(
                  'input.videoSuggestion.followUpChooserLabel',
                  'Pick a starting point, then edit it if you want.'
                )}
              </div>
              <div className={suggestedFollowUpsGridStyles}>
                {suggestedFollowUpPrompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    className={suggestedFollowUpButtonStyles}
                    onClick={() => {
                      onUseSuggestedFollowUp(prompt);
                      setShowSuggestedFollowUps(false);
                    }}
                    disabled={loading}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
