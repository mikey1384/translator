import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  HANDOFF_TRANSLATION_STARTED,
  PROVISIONAL_USAGE_EVENTS,
  RENDERER_HANDOFF_FUNNEL_EVENTS,
  handoffTranslationStartEvent,
  isRendererHandoffFunnelEvent,
  parseStartTrigger,
} from '../services/handoff-funnel.js';
import { isRendererPurchaseFunnelEvent } from '../services/purchase-funnel.js';
import {
  addCount,
  removeSent,
  takeBatch,
} from '../services/usage-count-buffer.js';

describe('handoff counts from the renderer', () => {
  it('allows exactly the home and handoff names', () => {
    assert.deepEqual(
      [...RENDERER_HANDOFF_FUNNEL_EVENTS],
      [
        'home_translate_clicked',
        'home_download_only_clicked',
        'download_handoff_shown',
        'download_handoff_clicked',
        'download_handoff_dismissed',
      ]
    );
    for (const event of RENDERER_HANDOFF_FUNNEL_EVENTS) {
      assert.ok(isRendererHandoffFunnelEvent(event), event);
      assert.ok(!isRendererPurchaseFunnelEvent(event), event);
    }
  });

  it('rejects anything else, including main-only names', () => {
    for (const event of [
      HANDOFF_TRANSLATION_STARTED,
      'transcription_started',
      'app_open',
      'home_translate',
      '',
      null,
      42,
    ]) {
      assert.ok(!isRendererHandoffFunnelEvent(event), String(event));
    }
  });
});

describe('runs started from the card', () => {
  it('adds a distinct count only for the known trigger', () => {
    assert.equal(parseStartTrigger('download_handoff'), 'download_handoff');
    assert.equal(parseStartTrigger('home'), undefined);
    assert.equal(
      handoffTranslationStartEvent('download_handoff'),
      'download_handoff_translation_started'
    );
    assert.equal(handoffTranslationStartEvent(undefined), null);
    assert.equal(handoffTranslationStartEvent({ x: 1 }), null);
  });
});

describe('anonymous count batches', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  let pending = addCount({}, 'app_open', now);
  pending = addCount(pending, 'translation_completed', now);
  pending = addCount(pending, 'download_handoff_shown', now);
  pending = addCount(pending, 'download_handoff_shown', now);
  pending = addCount(pending, HANDOFF_TRANSLATION_STARTED, now);

  it('never mixes provisional names into the established request', () => {
    const established = takeBatch(
      pending,
      e => !PROVISIONAL_USAGE_EVENTS.has(e)
    );
    const provisional = takeBatch(pending, e =>
      PROVISIONAL_USAGE_EVENTS.has(e)
    );
    assert.deepEqual(established.map(e => e.event).sort(), [
      'app_open',
      'translation_completed',
    ]);
    assert.deepEqual(provisional.map(e => [e.event, e.n]).sort(), [
      ['download_handoff_shown', 2],
      ['download_handoff_translation_started', 1],
    ]);
    // A refused provisional request keeps its counts; established ones sent.
    const afterEstablished = removeSent(pending, established);
    assert.deepEqual(Object.keys(afterEstablished).sort(), [
      '2026-11-14|download_handoff_shown',
      '2026-11-14|download_handoff_translation_started',
    ]);
  });

  it('marks every handoff name provisional and nothing established', () => {
    for (const e of [
      ...RENDERER_HANDOFF_FUNNEL_EVENTS,
      HANDOFF_TRANSLATION_STARTED,
    ])
      assert.ok(PROVISIONAL_USAGE_EVENTS.has(e), e);
    for (const e of ['app_open', 'app_first_open', 'transcription_started'])
      assert.ok(!PROVISIONAL_USAGE_EVENTS.has(e), e);
    assert.equal(PROVISIONAL_USAGE_EVENTS.size, 6);
  });
});
