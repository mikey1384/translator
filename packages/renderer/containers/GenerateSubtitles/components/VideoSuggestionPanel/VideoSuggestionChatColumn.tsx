import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
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
  loadingProgressFillStyles,
  loadingProgressHeaderStyles,
  loadingProgressLabelStyles,
  loadingProgressPercentStyles,
  loadingProgressTrackStyles,
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
import {
  calculateOverallPipelineProgress,
  clampPercent,
  inferRetrievalStageProgressFromMessage,
  runningStageTargetPercent,
  STAGE_PROGRESS_TICK_MS,
  type StageProgressMap,
} from './video-suggestion-helpers.js';

type VideoSuggestionChatColumnProps = {
  cancelling: boolean;
  compact: boolean;
  disabled: boolean;
  loading: boolean;
  input: string;
  messages: VideoSuggestionMessage[];
  loadingElapsedSec: number;
  loadingMessage: string;
  pipelineStages: PipelineStageProgress[];
  runningStage: PipelineStageProgress | null;
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
  pipelineStageLabel: (key: PipelineStageKey) => string;
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
  pipelineStages,
  runningStage,
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
  pipelineStageLabel,
}: VideoSuggestionChatColumnProps) {
  const [showSuggestedFollowUps, setShowSuggestedFollowUps] = useState(false);
  const [stageProgress, setStageProgress] = useState<StageProgressMap>({});
  const canShowSuggestedFollowUps = suggestedFollowUpPrompts.length > 0;
  const stageRunStartedAtRef = useRef<
    Partial<Record<PipelineStageKey, number>>
  >({});
  const pipelineStagesRef = useRef<PipelineStageProgress[]>(pipelineStages);

  const updateStageProgress = useCallback(
    (stages: PipelineStageProgress[], nowMs: number) => {
      setStageProgress(prev => {
        const next: StageProgressMap = { ...prev };
        for (const stage of stages) {
          if (stage.state === 'cleared') {
            next[stage.key] = 100;
            delete stageRunStartedAtRef.current[stage.key];
            continue;
          }

          if (stage.state === 'running') {
            const startedAt = stageRunStartedAtRef.current[stage.key] || nowMs;
            stageRunStartedAtRef.current[stage.key] = startedAt;
            const elapsedSec = Math.max(0, (nowMs - startedAt) / 1000);
            const target = runningStageTargetPercent(elapsedSec);
            const current = clampPercent(next[stage.key] ?? 0);
            next[stage.key] = clampPercent(Math.max(current, target));
            continue;
          }

          next[stage.key] = 0;
          delete stageRunStartedAtRef.current[stage.key];
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (!canShowSuggestedFollowUps || loading) {
      setShowSuggestedFollowUps(false);
    }
  }, [canShowSuggestedFollowUps, loading]);

  useEffect(() => {
    pipelineStagesRef.current = pipelineStages;
    updateStageProgress(pipelineStages, Date.now());
  }, [pipelineStages, updateStageProgress]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      updateStageProgress(pipelineStagesRef.current, Date.now());
    }, STAGE_PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [loading, updateStageProgress]);

  const retrievalStage = pipelineStages.find(
    stage => stage.key === 'retrieval'
  );
  const hintedRetrievalProgress =
    retrievalStage?.state === 'running'
      ? inferRetrievalStageProgressFromMessage(loadingMessage)
      : null;
  const effectiveStageProgress: StageProgressMap =
    hintedRetrievalProgress == null
      ? stageProgress
      : {
          ...stageProgress,
          retrieval: Math.max(
            stageProgress.retrieval ?? 0,
            hintedRetrievalProgress
          ),
        };
  const rawOverallProgressPercent = Math.round(
    calculateOverallPipelineProgress(pipelineStages, effectiveStageProgress)
  );
  const overallProgressPercent =
    loading && rawOverallProgressPercent >= 100
      ? 99
      : rawOverallProgressPercent;

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
            <div className={loadingProgressHeaderStyles}>
              <span className={loadingProgressLabelStyles}>
                {t(
                  'input.videoSuggestion.liveActivityTitle',
                  'Search progress'
                )}
              </span>
              <span className={loadingProgressPercentStyles}>
                {overallProgressPercent}%
              </span>
            </div>
            <div className={loadingProgressTrackStyles} aria-hidden="true">
              <div
                className={loadingProgressFillStyles}
                style={{ width: `${overallProgressPercent}%` }}
              />
            </div>
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
