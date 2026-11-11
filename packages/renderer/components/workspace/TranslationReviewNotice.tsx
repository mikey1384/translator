import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/css';
import Button from '../Button';
import { useSubStore, useUIStore } from '../../state';
import { useWorkspaceBusy } from './WorkspaceActions';
import { pendingTranslationReview } from '../../utils/translationReview';
import { resumeTranslationReview } from '../../utils/resumeTranslationReview';
import { useAiStore } from '../../state/ai-store';
import {
  acceptTranslationDraft,
  translationReviewNeedsDecision,
} from '../../../shared/helpers/translation-review';
import { saveMountedSubtitleDocument } from '../../utils/subtitle-documents';
import { useUrlStore } from '../../state/url-store';

const noticeStyle = css`
  padding: 12px 14px;
  margin: 8px 0;
  border: 1px solid #b88735;
  border-radius: 8px;
  background: rgba(184, 135, 53, 0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
  p {
    margin: 0;
  }
`;
const actionsStyle = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

export default function TranslationReviewNotice() {
  const { t } = useTranslation();
  const order = useSubStore(s => s.order);
  const segments = useSubStore(s => s.segments);
  const busy = useWorkspaceBusy();
  const useApiKeysMode = useAiStore(s => s.useApiKeysMode);
  const pending = useMemo(
    () => pendingTranslationReview(order.map(id => segments[id])),
    [order, segments]
  );
  if (!pending || busy) return null;
  const kept = !order.some(id => translationReviewNeedsDecision(segments[id]));
  const draftComplete = order.every(
    id => !segments[id].original.trim() || segments[id].translation?.trim()
  );
  const keepDraft = async () => {
    const state = useSubStore.getState();
    state.applyTranslations(
      state.order.map(id => acceptTranslationDraft(state.segments[id])),
      { matchByIndex: false, markDirty: true }
    );
    try {
      const saved = await saveMountedSubtitleDocument({ keepDirty: true });
      if (!saved.success) throw new Error(saved.error);
      useUrlStore.getState().clearError();
    } catch (error) {
      useUrlStore.getState().setOperationError(String(error));
    }
  };
  return (
    <aside
      className={noticeStyle}
      role="status"
      data-testid="translation-review-incomplete"
    >
      <strong>
        {t(
          draftComplete
            ? 'translationReview.incomplete'
            : 'translationReview.resume'
        )}
      </strong>
      {!kept && (
        <p>{t('translationReview.pending', { remaining: pending.count })}</p>
      )}
      <div className={actionsStyle}>
        {!kept && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void keepDraft();
            }}
          >
            {t('translationReview.keepDraft')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void resumeTranslationReview();
          }}
        >
          {t('translationReview.resume')}
        </Button>
        {!kept && !useApiKeysMode && (
          <Button
            size="sm"
            variant="text"
            onClick={() => useUIStore.getState().toggleSettings(true)}
          >
            {t('credits.pill.empty')}
          </Button>
        )}
      </div>
    </aside>
  );
}
