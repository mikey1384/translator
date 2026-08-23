import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOOL_SCHEMAS,
  mapFields,
} from '../../agent-server/src/packaged-mcp.mjs';
import { PACKAGED_TOOL_MAP } from '../../agent-server/src/packaged-tool-map.mjs';
import {
  AgentBackgroundOperationRouter,
  createAgentHistoryOperationId,
  isAgentHistoryOperationId,
  type AgentBackgroundProgress,
} from '../../renderer/listeners/agent-background-operations';
import { AgentClientSessionRouteRegistry } from '../utils/agent-client-session-routing';
import {
  AgentHistoryJobRegistry,
  createAgentSubtitleBatchSnapshot,
} from '../../renderer/listeners/agent-history-jobs';
import { AgentHistoryRouteRegistry } from '../utils/agent-history-routing';
import {
  AgentBridgeDeliveryUnknownError,
  AgentBridgeNotDeliveredError,
  AgentBridgeResponseError,
  isDefiniteAgentBridgeStartFailure,
} from '../utils/agent-bridge-delivery';

const HISTORY_AWARE_TOOLS = [
  'app_status',
  'app_start_transcription',
  'app_start_translation',
  'app_start_merge',
  'app_processing_status',
  'app_processing_cancel',
  'app_subtitles_get',
  'app_subtitles_export',
] as const;
const HISTORY_OPERATION =
  'agent-history:translation:00000000-0000-4000-8000-000000000001';

function createRouteTarget(id: number) {
  return {
    id,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
  };
}

test('packaged MCP exposes an executable schema for every allowed tool', () => {
  assert.deepEqual(
    Object.keys(TOOL_SCHEMAS).sort(),
    Object.keys(PACKAGED_TOOL_MAP).sort()
  );
});

test('packaged MCP history-aware tools accept non-empty history IDs', () => {
  for (const tool of HISTORY_AWARE_TOOLS) {
    const historyId = TOOL_SCHEMAS[tool].properties?.history_id;
    assert.deepEqual(
      historyId,
      { type: 'string', minLength: 1, maxLength: 512 },
      tool
    );
  }

  assert.deepEqual(TOOL_SCHEMAS.app_start_translation.required, [
    'target_language',
  ]);
  assert.deepEqual(TOOL_SCHEMAS.app_start_merge.required, ['output_path']);
  assert.deepEqual(TOOL_SCHEMAS.app_subtitles_export.required, ['path']);
  assert.deepEqual(TOOL_SCHEMAS.app_subtitles_export.properties?.mode, {
    type: 'string',
    enum: ['original', 'translation', 'dual'],
    default: 'dual',
  });
});

test('packaged MCP maps history and output fields without dropping ordinary fields', () => {
  assert.deepEqual(
    mapFields({
      history_id: 'history-123',
      output_path: '/tmp/video.mp4',
      target_language: 'French',
      path: '/tmp/subtitles.srt',
      mode: 'translation',
    }),
    {
      historyId: 'history-123',
      outputPath: '/tmp/video.mp4',
      targetLanguage: 'French',
      path: '/tmp/subtitles.srt',
      mode: 'translation',
    }
  );
});

test('packaged MCP tool map excludes human-gated mutations', () => {
  const methods = new Set(Object.values(PACKAGED_TOOL_MAP));
  assert.equal(methods.has('openCreditCheckout'), false);
  assert.equal(methods.has('storeProviderKey'), false);
  assert.equal(methods.has('clearProviderKey'), false);
});

test('background operation routing consumes active and trailing packets', () => {
  const router = new AgentBackgroundOperationRouter();
  const received: AgentBackgroundProgress[] = [];
  const finish = router.register(HISTORY_OPERATION, progress => {
    received.push(progress);
  });

  const activePacket = {
    operationId: HISTORY_OPERATION,
    percent: 40,
    stage: 'translating',
  };
  assert.equal(router.isActive(HISTORY_OPERATION), true);
  assert.equal(router.route(activePacket), true);
  assert.deepEqual(received, [activePacket]);

  finish();
  finish();
  assert.equal(router.isActive(HISTORY_OPERATION), false);
  assert.equal(
    router.route({ operationId: HISTORY_OPERATION, percent: 100 }),
    true,
    'late packets must stay classified and cannot fall through to mounted UI state'
  );
  assert.equal(received.length, 1);
  assert.equal(router.route({ operationId: 'mounted-operation' }), false);
  assert.throws(
    () => router.register('history-operation', () => undefined),
    /invalid or already active/
  );
});

test('history operation identities use an exact reserved structure', () => {
  const operationId = createAgentHistoryOperationId('merge');
  assert.equal(isAgentHistoryOperationId(operationId), true);
  assert.equal(isAgentHistoryOperationId(HISTORY_OPERATION), true);
  assert.equal(
    isAgentHistoryOperationId('agent-history:merge:not-a-uuid'),
    false
  );
  assert.equal(isAgentHistoryOperationId('translate-mounted-operation'), false);
});

test('background operation routing remains a safety boundary if its observer throws', () => {
  const router = new AgentBackgroundOperationRouter();
  router.register(HISTORY_OPERATION, () => {
    throw new Error('observer failed');
  });

  assert.doesNotThrow(() => {
    assert.equal(router.route({ operationId: HISTORY_OPERATION }), true);
  });
});

test('history job registry fences stale completions by exact operation identity', () => {
  const jobs = new AgentHistoryJobRegistry();
  jobs.start({
    historyId: 'history-1',
    operationId: 'operation-old',
    kind: 'transcription',
    stage: 'transcribing',
  });
  jobs.start({
    historyId: 'history-1',
    operationId: 'operation-current',
    kind: 'translation',
    stage: 'translating',
  });

  assert.equal(
    jobs.finish('history-1', 'operation-old', {
      status: 'completed',
      result: { stale: true },
    }),
    false
  );
  assert.equal(
    jobs.update('history-1', 'operation-current', {
      percent: 150,
      stage: 'reviewing',
    }),
    true
  );
  const active = jobs.active();
  assert.equal(active.length, 1);
  assert.equal(active[0]?.historyId, 'history-1');
  assert.equal(active[0]?.operationId, 'operation-current');
  assert.equal(active[0]?.percent, 100);
  assert.equal(active[0]?.stage, 'reviewing');
  assert.equal(active[0]?.inProgress, true);

  assert.equal(
    jobs.finish('history-1', 'operation-current', {
      status: 'completed',
      result: { cueCount: 3 },
    }),
    true
  );
  assert.equal(jobs.active().length, 0);
  const completed = jobs.get('history-1');
  assert.equal(completed?.status, 'completed');
  assert.deepEqual(completed?.result, { cueCount: 3 });
  assert.equal(completed?.inProgress, false);
  assert.equal(
    jobs.markCancelling('history-1', 'operation-current'),
    false,
    'a late cancel acknowledgement must not turn a completed job back into cancelling'
  );
});

test('history job registry bounds terminal retention without evicting active work', () => {
  const jobs = new AgentHistoryJobRegistry(1);
  for (const historyId of ['finished-1', 'finished-2']) {
    jobs.start({
      historyId,
      operationId: `operation-${historyId}`,
      kind: 'transcription',
      stage: 'transcribing',
    });
    jobs.finish(historyId, `operation-${historyId}`, {
      status: 'completed',
      result: { historyId },
    });
  }
  jobs.start({
    historyId: 'active',
    operationId: 'operation-active',
    kind: 'merge',
    stage: 'merging',
  });

  assert.equal(jobs.get('finished-1'), null);
  assert.equal(jobs.get('finished-2')?.status, 'completed');
  assert.equal(jobs.get('active')?.inProgress, true);
  assert.equal(jobs.size(), 2);
});

test('history routing keeps follow-ups on their owner and balances concurrent jobs', () => {
  const routes = new AgentHistoryRouteRegistry<{
    id: number;
    destroyed: boolean;
    isDestroyed(): boolean;
  }>();
  const first = {
    id: 1,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
  };
  const second = {
    id: 2,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
  };

  assert.equal(routes.chooseLeastLoaded([first, second], first), first);
  routes.setActive('history-1', first);
  assert.equal(routes.isActive('history-1', first), true);
  assert.equal(
    routes.chooseLeastLoaded([first, second], first),
    second,
    'a concurrent history job should prefer the idle renderer'
  );
  routes.setActive('history-2', second);
  assert.equal(routes.get('history-1'), first);
  assert.equal(routes.get('history-2'), second);

  assert.equal(routes.markInactive('history-1', second), false);
  assert.equal(routes.markInactive('history-1', first), true);
  assert.equal(routes.isActive('history-1', first), false);
  assert.equal(
    routes.chooseLeastLoaded([first, second], first),
    first,
    'a completed route must stop counting as active load'
  );

  first.destroyed = true;
  assert.equal(routes.get('history-1'), null);
  assert.equal(routes.deleteIfTarget('history-2', first), false);
  assert.equal(routes.get('history-2'), second);
});

test('packaged helper sessions stay pinned across idle socket reconnects', () => {
  let tokenSequence = 0;
  const routes = new AgentClientSessionRouteRegistry(
    () => `route-${++tokenSequence}`
  );
  const first = createRouteTarget(1);
  const second = createRouteTarget(2);

  const initial = routes.bind('client-1', null, first);
  assert.equal(initial.target, first);
  assert.equal(initial.routeToken, 'route-1');
  assert.equal(routes.resolve(initial.routeToken), first);

  assert.equal(
    routes.bind('client-1', null, second),
    initial,
    'a retry after a lost handshake response must retain the original tab'
  );
  assert.equal(
    routes.bind('client-1', initial.routeToken, second),
    initial,
    'a reconnect must ignore a newly active tab'
  );
  assert.throws(
    () => routes.bind('client-1', 'forged-route', second),
    /stale or invalid/
  );

  first.destroyed = true;
  assert.throws(
    () => routes.resolve(initial.routeToken),
    /owned by this agent session was closed/
  );
});

test('evicted packaged workspace leases fail closed instead of changing tabs', () => {
  let tokenSequence = 0;
  const routes = new AgentClientSessionRouteRegistry(
    () => `route-${++tokenSequence}`,
    2
  );
  const first = createRouteTarget(1);
  const second = createRouteTarget(2);
  const third = createRouteTarget(3);

  const oldest = routes.bind('client-oldest', null, first);
  const retained = routes.bind('client-retained', null, second);
  routes.resolve(retained.routeToken);
  routes.bind('client-new', null, third);

  assert.equal(routes.size(), 2);
  assert.throws(() => routes.resolve(oldest.routeToken), /lease expired/);
  assert.throws(
    () => routes.bind('client-oldest', oldest.routeToken, third),
    /stale or invalid/,
    'an evicted helper must never be rebound to whichever tab is active'
  );
  assert.equal(routes.resolve(retained.routeToken), second);
});

test('history route retention is bounded only for inactive routes', () => {
  const target = { id: 1, isDestroyed: () => false };
  const routes = new AgentHistoryRouteRegistry<typeof target>(1);
  routes.setActive('finished-1', target);
  routes.markInactive('finished-1', target);
  routes.setActive('still-active', target);
  routes.setActive('finished-2', target);
  routes.markInactive('finished-2', target);

  assert.equal(routes.get('finished-1'), null);
  assert.equal(routes.get('finished-2'), target);
  assert.equal(routes.get('still-active'), target);
  assert.equal(routes.isActive('still-active', target), true);
});

test('history terminal acknowledgements are generation-fenced and failed starts restore the prior route', () => {
  const target = { id: 1, isDestroyed: () => false };
  const routes = new AgentHistoryRouteRegistry<typeof target>();
  routes.setActive('history-1', target, 'old-token');

  const previous = routes.setActive('history-1', target, 'new-token');
  assert.equal(
    routes.markInactiveByToken('history-1', target, 'old-token'),
    false,
    'a stale completion must not retire a replacement start'
  );
  assert.equal(routes.restoreIfToken('history-1', 'new-token', previous), true);
  assert.equal(routes.isActive('history-1', target), true);
  assert.equal(
    routes.markInactiveByToken('history-1', target, 'old-token'),
    true
  );

  routes.setActive('history-1', target, 'latest-token');
  assert.equal(
    routes.restoreIfToken('history-1', 'new-token', previous),
    false,
    'a late rejection must not restore over a newer start'
  );
  assert.equal(routes.isActive('history-1', target), true);
});

test('the bridge rejects duplicate active history starts before replacing their generation', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(testDirectory, '../../..');
  const bridgeSource = fs.readFileSync(
    path.join(projectRoot, 'packages/main/handlers/agent-bridge-handlers.ts'),
    'utf8'
  );

  const activeCheck = bridgeSource.indexOf('if (existing?.active)');
  const replacement = bridgeSource.indexOf(
    'previousRoute = historyRoutes.setActive'
  );
  assert.ok(activeCheck >= 0 && replacement > activeCheck);
});

test('delayed history follow-up responses cannot retire a replacement generation', () => {
  const target = { id: 1, isDestroyed: () => false };
  const routes = new AgentHistoryRouteRegistry<typeof target>();
  routes.setActive('history-1', target, 'observed-token');
  const observed = routes.getSnapshot('history-1');
  assert.equal(observed?.token, 'observed-token');

  routes.setActive('history-1', target, 'replacement-token');
  assert.equal(
    routes.markInactiveByToken('history-1', observed!.target, observed!.token!),
    false,
    'a stale status or cancellation result must not retire the newer start'
  );
  assert.equal(routes.isActive('history-1', target), true);
});

test('completed history jobs notify main without waiting for a polling client', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(testDirectory, '../../..');
  const bridgeSource = fs.readFileSync(
    path.join(projectRoot, 'packages/main/handlers/agent-bridge-handlers.ts'),
    'utf8'
  );
  const rendererSource = fs.readFileSync(
    path.join(
      projectRoot,
      'packages/renderer/listeners/translator-agent-listener.ts'
    ),
    'utf8'
  );

  assert.ok(
    bridgeSource.includes("'agent-history-job-terminal'") &&
      bridgeSource.includes('markInactiveByToken') &&
      bridgeSource.includes('event.sender'),
    'main must accept only sender- and generation-bound terminal notices'
  );
  assert.ok(
    rendererSource.includes('.finally(() => {') &&
      rendererSource.includes('reportAgentHistoryJobTerminal'),
    'every history runner outcome must release its main-process active route'
  );
});

test('history start delivery distinguishes definite rejection from ambiguous loss', () => {
  assert.equal(
    isDefiniteAgentBridgeStartFailure(
      new AgentBridgeResponseError('renderer rejected start')
    ),
    true
  );
  assert.equal(
    isDefiniteAgentBridgeStartFailure(
      new AgentBridgeNotDeliveredError('renderer was gone before send')
    ),
    true
  );
  assert.equal(
    isDefiniteAgentBridgeStartFailure(
      new Error('client disconnected after request was sent')
    ),
    false
  );
  assert.equal(
    isDefiniteAgentBridgeStartFailure(new Error('agent bridge timeout')),
    false
  );
  assert.equal(
    isDefiniteAgentBridgeStartFailure(
      new AgentBridgeDeliveryUnknownError('renderer disappeared after send')
    ),
    false
  );
});

test('subtitle snapshots are synchronous, bounded, and paginated', () => {
  const snapshot = createAgentSubtitleBatchSnapshot(
    [
      { id: 'one', index: 1, start: 0, end: 1, original: 'One' },
      {
        id: 'two',
        index: 2,
        start: 1,
        end: 2,
        original: 'Two',
        translation: 'Deux',
      },
      { id: 'three', index: 3, start: 2, end: 3, original: 'Three' },
    ],
    { offset: 1, limit: 1, sourceNote: 'library item' }
  );

  assert.equal(snapshot instanceof Promise, false);
  assert.deepEqual(snapshot, {
    offset: 1,
    limit: 1,
    total: 3,
    hasMore: true,
    sourceNote: 'library item',
    cues: [
      {
        id: 'two',
        index: 2,
        start: 1,
        end: 2,
        original: 'Two',
        translation: 'Deux',
      },
    ],
  });
});
