import { useEffect, useRef, useState } from 'react';
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

export default function HighlightEditorialEditor({
  highlight,
  disabled,
  onSaved,
}: {
  highlight: TranscriptHighlight;
  disabled: boolean;
  onSaved: () => void;
}) {
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
      setError((e as Error).message);
    }
  }
  async function save(remove = false) {
    if (!highlight.id) {
      setError('Save the highlight selection first.');
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
      setError((e as Error).message);
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
          ? 'Close edit'
          : highlight.editorial
            ? 'Edit framing & captions'
            : 'Style this Short'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {plan && (
        <fieldset
          disabled={disabled || saving}
          style={{
            border: '1px solid #555',
            borderRadius: 12,
            padding: 16,
            marginTop: 12,
          }}
        >
          <legend>Shorts framing & captions</legend>
          <p>
            Frame each speaker, split at camera cuts, and time short caption
            phrases to the speech. Times below start at the beginning of this
            clip.
          </p>
          <div
            style={{
              position: 'relative',
              width: 270,
              height: 480,
              background: '#171717',
              margin: '12px auto',
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
            Preview · {time.toFixed(2)}s
            <input
              aria-label="Short preview time"
              type="range"
              min={0}
              max={Math.max(0, duration - 0.05)}
              step={0.04}
              value={time}
              style={{ width: '100%' }}
              onChange={e => setTime(Number(e.target.value))}
            />
          </label>
          <label>
            Speaker / topic
            <input
              aria-label="Speaker or topic label"
              value={plan.label || ''}
              maxLength={60}
              onChange={e => setPlan({ ...plan, label: e.target.value })}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <p>
            Shot {Math.max(0, shotIndex) + 1} of {plan.shots.length} ·{' '}
            {shot?.start.toFixed(2)}–{shot?.end.toFixed(2)}s
          </p>
          {shot &&
            (['centerX', 'centerY', 'zoom'] as const).map(key => (
              <label key={key} style={{ display: 'block' }}>
                {
                  {
                    centerX: 'Horizontal focus',
                    centerY: 'Vertical focus',
                    zoom: 'Zoom',
                  }[key]
                }{' '}
                · {shot[key].toFixed(2)}
                <input
                  aria-label={key}
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
                  style={{ width: '100%' }}
                />
              </label>
            ))}
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
            Split shot at playhead
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
            Join previous shot
          </Button>
          <p>
            Caption phrases · emphasize an exact word or phrase from the text.
          </p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {plan.captions.map((c, i) => (
              <div
                key={i}
                style={{
                  borderTop: '1px solid #555',
                  padding: '12px 0',
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div>
                  {(['start', 'end'] as const).map(key => (
                    <label key={key}>
                      {key === 'start' ? 'From ' : ' to '}
                      <input
                        aria-label={`Caption ${i + 1} ${key}`}
                        type="number"
                        min={0}
                        max={duration}
                        step={0.01}
                        value={c[key]}
                        style={{ width: 76 }}
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
                  ))}{' '}
                  s{' '}
                  <button type="button" onClick={() => setTime(c.start)}>
                    Preview
                  </button>
                </div>
                <textarea
                  aria-label={`Caption ${i + 1} text`}
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
                  aria-label={`Caption ${i + 1} emphasis`}
                  placeholder="Emphasize this phrase"
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
                <div>
                  <button
                    type="button"
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
                    Split phrase
                  </button>{' '}
                  <button
                    type="button"
                    onClick={() =>
                      setPlan({
                        ...plan,
                        captions: plan.captions.filter((_, n) => n !== i),
                      })
                    }
                  >
                    Remove phrase
                  </button>
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
            Add phrase
          </Button>
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <Button size="sm" variant="primary" onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save Short edit'}
            </Button>
            {highlight.editorial && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void save(true)}
              >
                Remove styling
              </Button>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}
