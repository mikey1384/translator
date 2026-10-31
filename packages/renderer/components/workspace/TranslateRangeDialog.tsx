import { useEffect, useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Button from '../Button';
import Modal from '../Modal';
import { colors, fonts } from '../../styles';
import { useSubStore } from '../../state';
import { useTranslateRangeStore } from '../../state/translate-range-store';
import { getNativePlayerInstance } from '../../native-player';
import { useCreditCostEstimates } from '../../hooks/useCreditCostEstimates';
import { precheckTranslationCredits } from '../../utils/credit-precheck';
import { formatUiInteger } from '../../utils/formatNumbers';
import { logButton } from '../../utils/logger';
import {
  allUntranslatedIds,
  startIndexForTime,
  untranslatedRunFrom,
} from '../../utils/untranslatedRange';
import { formatCueTime } from './ReadOnlySubtitleList';

const optionsStyles = css`
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
`;

const optionStyles = css`
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  min-height: 44px;
  border-radius: 14px;
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &:hover {
    border-color: ${colors.borderStrong};
  }

  input {
    accent-color: ${colors.primary};
    width: 18px;
    height: 18px;
    margin: 0;
  }
`;

const optionSelectedStyles = css`
  border-color: ${colors.primary};
  background: rgba(255, 216, 77, 0.06);

  &:hover {
    border-color: ${colors.primary};
  }
`;

const optionDisabledStyles = css`
  opacity: 0.5;
  cursor: not-allowed;
`;

const optionLabelStyles = css`
  display: grid;
  gap: 3px;
  min-width: 0;
  color: ${colors.text};
  font-weight: 600;
`;

const optionDetailStyles = css`
  color: ${colors.textDim};
  font-weight: 400;
  font-size: 0.9rem;
`;

const countStyles = css`
  font-family: ${fonts.display};
  font-weight: 700;
  font-size: 1.15rem;
  color: ${colors.primary};
  font-variant-numeric: tabular-nums;
`;

const noteStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: 0.9rem;
  line-height: 1.5;
`;

interface Props {
  /** The language the missing lines are translated into. */
  language: { value: string; name: string; into: string };
  onTranslate: (ids: string[]) => void;
}

type Choice = 'fromHere' | 'all';

/**
 * Picks which untranslated lines to translate: from a line (the one playing,
 * or the one the editor's "Translate from here" was pressed on) through the
 * untranslated lines after it, stopping at the next translated line; or every
 * untranslated line. Translated lines are never sent again.
 */
export default function TranslateRangeDialog({ language, onTranslate }: Props) {
  const { t } = useTranslation();
  const request = useTranslateRangeStore(s => s.request);
  const close = useTranslateRangeStore(s => s.close);
  const order = useSubStore(s => s.order);
  const segments = useSubStore(s => s.segments);
  const { estimateTranslationOf, formatCostLabel } = useCreditCostEstimates();

  useEffect(() => {
    useTranslateRangeStore.getState().setAvailable(true);
    return () => useTranslateRangeStore.getState().setAvailable(false);
  }, []);

  // Fix the start when the dialog opens: the video keeps playing behind it.
  const [startIndex, setStartIndex] = useState(-1);
  useEffect(() => {
    if (!request) return;
    const state = useSubStore.getState();
    const cues = state.order.map(id => state.segments[id]);
    if (request.startId) {
      setStartIndex(state.order.indexOf(request.startId));
    } else {
      const time = getNativePlayerInstance()?.currentTime ?? 0;
      setStartIndex(startIndexForTime(cues, time));
    }
  }, [request]);

  const cues = useMemo(
    () => order.map(id => segments[id]).filter(Boolean),
    [order, segments]
  );
  const run = useMemo(
    () => untranslatedRunFrom(cues, Math.max(0, startIndex)),
    [cues, startIndex]
  );
  const allIds = useMemo(() => allUntranslatedIds(cues), [cues]);

  const [choice, setChoice] = useState<Choice>('fromHere');
  useEffect(() => {
    if (request) setChoice('fromHere');
  }, [request]);
  const effectiveChoice: Choice =
    choice === 'fromHere' && !run ? 'all' : choice;
  const ids = useMemo(
    () => (effectiveChoice === 'fromHere' ? (run?.ids ?? []) : allIds),
    [effectiveChoice, run, allIds]
  );

  const chosenLines = useMemo(() => {
    const wanted = new Set(ids);
    return cues.filter(cue => wanted.has(cue.id));
  }, [cues, ids]);
  const estimate = estimateTranslationOf(chosenLines);

  const lineLabel = (index: number) => {
    const cue = cues[index];
    return cue ? `#${index + 1} · ${formatCueTime(cue.start)}` : '';
  };

  const open = Boolean(request) && startIndex !== -1 && allIds.length > 0;
  // Nothing to choose from (e.g. the last line was just translated).
  useEffect(() => {
    if (request && startIndex !== -1 && allIds.length === 0) close();
  }, [request, startIndex, allIds.length, close]);

  const confirm = () => {
    if (!ids.length) return;
    logButton('workspace_translate_range', {
      choice: effectiveChoice,
      lines: ids.length,
    });
    close();
    if (!precheckTranslationCredits()) return;
    onTranslate(ids);
  };

  return (
    <Modal
      open={open}
      title={t(
        'workspace.translateGap.title',
        'Translate missing lines into {{language}}',
        { language: language.name, languageInto: language.into }
      )}
      titleId="translate-range-title"
      onClose={close}
      actions={
        <>
          <Button variant="text" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={confirm}
            disabled={!ids.length}
            data-testid="translate-range-confirm"
          >
            {t('subtitles.translate', 'Translate')}
          </Button>
        </>
      }
    >
      <div className={optionsStyles} role="radiogroup">
        <label
          className={cx(
            optionStyles,
            effectiveChoice === 'fromHere' && optionSelectedStyles,
            !run && optionDisabledStyles
          )}
          data-testid="translate-range-from-here"
        >
          <input
            type="radio"
            name="translate-range"
            checked={effectiveChoice === 'fromHere'}
            disabled={!run}
            onChange={() => setChoice('fromHere')}
          />
          <span className={optionLabelStyles}>
            {!run
              ? t(
                  'workspace.translateGap.nothingFromHere',
                  'Nothing left to translate from this point'
                )
              : run.stopIndex === -1
                ? t(
                    'workspace.translateGap.fromHereToEnd',
                    'From here to the end'
                  )
                : t(
                    'workspace.translateGap.fromHere',
                    'From here to the next translated line'
                  )}
            {run ? (
              <span className={optionDetailStyles} dir="ltr">
                {lineLabel(run.firstIndex)}
                {run.lastIndex !== run.firstIndex
                  ? ` → ${lineLabel(run.lastIndex)}`
                  : ''}
              </span>
            ) : null}
          </span>
          {run ? (
            <span className={countStyles}>
              {formatUiInteger(run.ids.length)}
            </span>
          ) : null}
        </label>
        <label
          className={cx(
            optionStyles,
            effectiveChoice === 'all' && optionSelectedStyles
          )}
          data-testid="translate-range-all"
        >
          <input
            type="radio"
            name="translate-range"
            checked={effectiveChoice === 'all'}
            onChange={() => setChoice('all')}
          />
          <span className={optionLabelStyles}>
            {t('workspace.translateGap.all', 'All missing lines')}
          </span>
          <span className={countStyles}>{formatUiInteger(allIds.length)}</span>
        </label>
      </div>
      <p className={noteStyles}>
        {t(
          'workspace.translateGap.keepsTranslated',
          'Lines that already have a translation stay as they are.'
        )}
        {!estimate.isByo && estimate.estimatedCredits > 0 ? (
          <>
            {' '}
            <bdi>
              {t('workspace.translateGap.cost', 'Uses {{cost}}.', {
                cost: formatCostLabel(estimate.estimatedCredits),
              })}
            </bdi>
          </>
        ) : null}
      </p>
    </Modal>
  );
}
