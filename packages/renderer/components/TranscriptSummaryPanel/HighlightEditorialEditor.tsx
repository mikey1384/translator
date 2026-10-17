import { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { colors, fonts } from '../../styles';
import { borderRadius, fontSize, spacing } from '../design-system/tokens.js';
import type {
  HighlightEditorialPlan,
  TranscriptHighlight,
} from '@shared-types/app';
import { editorialCrop } from '../../../shared/helpers/highlight-editorial';
import { editorialCaptionHtml } from '../../../shared/helpers/editorial-caption-html';
import {
  mountedHighlightContext,
  saveMountedHighlightEditorial,
} from '../../listeners/agent-highlights';
import { toFileUrl } from './TranscriptSummaryPanel.helpers';
import Button from '../Button';
import { formatUiDecimal } from '../../utils/formatNumbers';

// The editor sits inside the dark clip card: native controls get the app's
// surfaces, borders and yellow accent instead of white OS widgets.
const editorStyles = css`
  border: 1px solid ${colors.borderStrong};
  border-radius: ${borderRadius.xl};
  padding: ${spacing.lg};
  margin: ${spacing.md} 0 0;
  min-width: 0;
  display: grid;
  gap: ${spacing.md};
  color: ${colors.text};
  font-size: ${fontSize.sm};

  legend {
    padding: 0 ${spacing.xs};
    font-weight: 600;
  }
  p {
    margin: 0;
    color: ${colors.textDim};
  }
  label {
    display: grid;
    gap: ${spacing.xs};
    color: ${colors.textDim};
  }
  input:not([type='range']),
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid ${colors.border};
    border-radius: ${borderRadius.md};
    background: ${colors.surfaceSoft};
    color: ${colors.text};
    font: inherit;
    font-family: ${fonts.body};
  }
  input:not([type='range']):focus,
  textarea:focus {
    outline: none;
    border-color: ${colors.primary};
  }
  textarea {
    resize: vertical;
  }
  input[type='range'] {
    width: 100%;
    accent-color: ${colors.primary};
  }
  input[type='number'] {
    width: 88px;
  }
`;

const timeRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: ${spacing.sm};

  label {
    display: grid;
  }
`;

const buttonRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
`;

const phraseStyles = css`
  border-top: 1px solid ${colors.border};
  padding: ${spacing.md} 0;
  display: grid;
  gap: ${spacing.sm};
`;

function seconds(value: number | undefined): string {
  return formatUiDecimal(value ?? 0, 2);
}

export default function HighlightEditorialEditor({
  highlight,
  disabled,
  onSaved,
}: {
  highlight: TranscriptHighlight;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<HighlightEditorialPlan | null>(null);
  const [source, setSource] = useState('');
  const [snapshot, setSnapshot] = useState('');
  const [time, setTime] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const duration = highlight.end - highlight.start;
  const shotIndex =
    plan?.shots.findIndex(s => time >= s.start && time < s.end) ?? -1;
  const shot = plan?.shots[Math.max(0, shotIndex)];
  const caption = plan?.captions.find(c => time >= c.start && time < c.end);

  function drawFrame() {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || !shot || !v.videoWidth) return;
    const crop = editorialCrop(shot, v.videoWidth, v.videoHeight);
    c.getContext('2d')?.drawImage(
      v,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      c.width,
      c.height
    );
  }
  useEffect(() => {
    if (video.current && source)
      video.current.currentTime = highlight.start + time;
  }, [time, source, highlight.start]);
  useEffect(drawFrame, [shot, time]);

  async function open() {
    try {
      const context = await mountedHighlightContext();
      setSource(context.videoPath);
      setSnapshot(context.snapshotId);
      setTime(0);
      setError('');
      setPlan(
        highlight.editorial
          ? structuredClone(highlight.editorial)
          : {
              shots: [
                {
                  start: 0,
                  end: duration,
                  centerX: 0.5,
                  centerY: 0.5,
                  zoom: 1,
                },
              ],
              captions: context.segments
                .filter(c => c.end > highlight.start && c.start < highlight.end)
                .map(c => ({
                  start: Math.max(0, c.start - highlight.start),
                  end: Math.min(duration, c.end - highlight.start),
                  text: (context.ui.subtitleDisplayMode === 'original'
                    ? c.original
                    : c.translation || c.original
                  ).trim(),
                })),
            }
      );
    } catch (e) {
      console.error('[HighlightEditorialEditor] open failed', e);
      setError(
        t(
          'highlightEditor.openFailed',
          "Couldn't open this clip for styling. Make sure the video and its subtitles are open."
        )
      );
    }
  }
  async function save(remove = false) {
    if (!highlight.id) {
      setError(
        t(
          'highlightEditor.saveSelectionFirst',
          'Save the highlight selection first.'
        )
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveMountedHighlightEditorial(
        highlight.id,
        remove ? null : plan,
        snapshot
      );
      onSaved();
      setPlan(null);
    } catch (e) {
      console.error('[HighlightEditorialEditor] save failed', e);
      setError(
        t(
          'highlightEditor.saveFailed',
          "Couldn't save the Short edit. Check that each phrase has text and its times are inside the clip."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || saving}
        onClick={() => (plan ? setPlan(null) : void open())}
      >
        {plan
          ? t('highlightEditor.closeEdit', 'Close edit')
          : highlight.editorial
            ? t('highlightEditor.editFraming', 'Edit framing & captions')
            : t('highlightEditor.styleShort', 'Style this Short')}
      </Button>
      {error && (
        <p role="alert" style={{ color: colors.danger, margin: '8px 0 0' }}>
          {error}
        </p>
      )}
      {plan && (
        <fieldset disabled={disabled || saving} className={editorStyles}>
          <legend>
            {t('highlightEditor.legend', 'Shorts framing & captions')}
          </legend>
          <p>
            {t(
              'highlightEditor.intro',
              'Frame each speaker, split at camera cuts, and time short caption phrases to the speech. Times below start at the beginning of this clip.'
            )}
          </p>
          <div
            style={{
              position: 'relative',
              width: 270,
              height: 480,
              background: colors.surfaceSoft,
              borderRadius: 8,
              overflow: 'hidden',
              margin: '0 auto',
            }}
          >
            <canvas
              ref={canvas}
              width={540}
              height={960}
              style={{ width: '100%', height: '100%' }}
            />
            <div
              style={{ position: 'absolute', inset: 0 }}
              dangerouslySetInnerHTML={{
                __html: editorialCaptionHtml(
                  {
                    mode: 'editorial',
                    text: caption?.text || '',
                    emphasis: caption?.emphasis,
                    label: plan.label,
                  },
                  270
                ),
              }}
            />
          </div>
          <video
            ref={video}
            src={toFileUrl(source)}
            preload="auto"
            style={{ display: 'none' }}
            onLoadedMetadata={() => {
              if (video.current)
                video.current.currentTime = highlight.start + time;
            }}
            onSeeked={drawFrame}
          />
          <label>
            {t('highlightEditor.previewAt', {
              defaultValue: 'Preview at {{seconds}} s',
              seconds: seconds(time),
            })}
            <input
              aria-label={t(
                'highlightEditor.previewTime',
                'Short preview time'
              )}
              type="range"
              min={0}
              max={Math.max(0, duration - 0.05)}
              step={0.04}
              value={time}
              onChange={e => setTime(Number(e.target.value))}
            />
          </label>
          <label>
            {t('highlightEditor.speakerLabel', 'Speaker or topic label')}
            <input
              aria-label={t(
                'highlightEditor.speakerLabel',
                'Speaker or topic label'
              )}
              value={plan.label || ''}
              maxLength={60}
              onChange={e => setPlan({ ...plan, label: e.target.value })}
            />
          </label>
          <p>
            {t('highlightEditor.shotPosition', {
              defaultValue: 'Shot {{current}} of {{total}}',
              current: Math.max(0, shotIndex) + 1,
              total: plan.shots.length,
            })}{' '}
            ·{' '}
            <bdi dir="ltr">
              {seconds(shot?.start)}–{seconds(shot?.end)}
            </bdi>
          </p>
          {shot &&
            (['centerX', 'centerY', 'zoom'] as const).map(key => (
              <label key={key}>
                {
                  {
                    centerX: t(
                      'highlightEditor.horizontalFocus',
                      'Horizontal focus'
                    ),
                    centerY: t(
                      'highlightEditor.verticalFocus',
                      'Vertical focus'
                    ),
                    zoom: t('highlightEditor.zoom', 'Zoom'),
                  }[key]
                }{' '}
                · {formatUiDecimal(shot[key], 2)}
                <input
                  type="range"
                  min={key === 'zoom' ? 1 : 0}
                  max={key === 'zoom' ? 2.5 : 1}
                  step={0.01}
                  value={shot[key]}
                  onChange={e =>
                    setPlan({
                      ...plan,
                      shots: plan.shots.map((s, i) =>
                        i === Math.max(0, shotIndex)
                          ? { ...s, [key]: Number(e.target.value) }
                          : s
                      ),
                    })
                  }
                />
              </label>
            ))}
          <div className={buttonRowStyles}>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                !shot ||
                time - shot.start < 0.08 ||
                shot.end - time < 0.08 ||
                plan.shots.length >= 40
              }
              onClick={() => {
                if (shot)
                  setPlan({
                    ...plan,
                    shots: plan.shots.flatMap((s, i) =>
                      i === shotIndex
                        ? [
                            { ...s, end: time },
                            { ...s, start: time },
                          ]
                        : [s]
                    ),
                  });
              }}
            >
              {t('highlightEditor.splitShot', 'Split shot at playhead')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={shotIndex <= 0}
              onClick={() =>
                setPlan({
                  ...plan,
                  shots: plan.shots.flatMap((s, i) =>
                    i === shotIndex - 1
                      ? [{ ...s, end: plan.shots[i + 1].end }]
                      : i === shotIndex
                        ? []
                        : [s]
                  ),
                })
              }
            >
              {t('highlightEditor.joinShot', 'Join previous shot')}
            </Button>
          </div>
          <p>
            {t(
              'highlightEditor.phrasesHint',
              'Caption phrases: to highlight a word, type the exact word or phrase from the text in its box.'
            )}
          </p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {plan.captions.map((c, i) => (
              <div key={i} className={phraseStyles}>
                <div className={timeRowStyles}>
                  {(['start', 'end'] as const).map(key => (
                    <label key={key}>
                      {key === 'start'
                        ? t('highlightEditor.from', 'From')
                        : t('highlightEditor.to', 'to')}
                      <input
                        aria-label={
                          key === 'start'
                            ? t('highlightEditor.phraseStart', {
                                defaultValue: 'Phrase {{index}} start (s)',
                                index: i + 1,
                              })
                            : t('highlightEditor.phraseEnd', {
                                defaultValue: 'Phrase {{index}} end (s)',
                                index: i + 1,
                              })
                        }
                        type="number"
                        min={0}
                        max={duration}
                        step={0.01}
                        value={c[key]}
                        onChange={e =>
                          setPlan({
                            ...plan,
                            captions: plan.captions.map((item, n) =>
                              n === i
                                ? { ...item, [key]: Number(e.target.value) }
                                : item
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <Button
                    size="sm"
                    variant="text"
                    onClick={() => setTime(c.start)}
                  >
                    {t('highlightEditor.preview', 'Preview')}
                  </Button>
                </div>
                <textarea
                  aria-label={t('highlightEditor.phraseText', {
                    defaultValue: 'Phrase {{index}} text',
                    index: i + 1,
                  })}
                  value={c.text}
                  rows={2}
                  onChange={e =>
                    setPlan({
                      ...plan,
                      captions: plan.captions.map((item, n) =>
                        n === i ? { ...item, text: e.target.value } : item
                      ),
                    })
                  }
                />
                <input
                  aria-label={t('highlightEditor.phraseEmphasis', {
                    defaultValue: 'Phrase {{index}} emphasis',
                    index: i + 1,
                  })}
                  placeholder={t(
                    'highlightEditor.emphasize',
                    'Emphasize this phrase'
                  )}
                  value={c.emphasis || ''}
                  onChange={e =>
                    setPlan({
                      ...plan,
                      captions: plan.captions.map((item, n) =>
                        n === i ? { ...item, emphasis: e.target.value } : item
                      ),
                    })
                  }
                />
                <div className={buttonRowStyles}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={plan.captions.length >= 160}
                    onClick={() => {
                      const words = c.text.split(/\s+/);
                      const middle = Math.ceil(words.length / 2);
                      const split = (c.start + c.end) / 2;
                      setPlan({
                        ...plan,
                        captions: plan.captions.flatMap((item, n) =>
                          n === i
                            ? [
                                {
                                  start: c.start,
                                  end: split,
                                  text: words.slice(0, middle).join(' '),
                                },
                                {
                                  start: split,
                                  end: c.end,
                                  text: words.slice(middle).join(' '),
                                },
                              ]
                            : [item]
                        ),
                      });
                    }}
                  >
                    {t('highlightEditor.splitPhrase', 'Split phrase')}
                  </Button>
                  <Button
                    size="sm"
                    variant="text"
                    onClick={() =>
                      setPlan({
                        ...plan,
                        captions: plan.captions.filter((_, n) => n !== i),
                      })
                    }
                  >
                    {t('highlightEditor.removePhrase', 'Remove phrase')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={plan.captions.length >= 160}
            onClick={() =>
              setPlan({
                ...plan,
                captions: [
                  ...plan.captions,
                  { start: time, end: Math.min(duration, time + 2), text: '' },
                ].sort((a, b) => a.start - b.start),
              })
            }
          >
            {t('highlightEditor.addPhrase', 'Add phrase')}
          </Button>
          <p>
            {t(
              'highlightEditor.saveNote',
              'Saving switches this clip to Shorts Reframe with these phrase captions instead of your subtitle style.'
            )}
          </p>
          <div className={buttonRowStyles}>
            <Button size="sm" variant="primary" onClick={() => void save()}>
              {saving
                ? t('highlightEditor.saving', 'Saving…')
                : t('highlightEditor.save', 'Save Short edit')}
            </Button>
            {highlight.editorial && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void save(true)}
              >
                {t('highlightEditor.removeStyling', 'Remove styling')}
              </Button>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}
