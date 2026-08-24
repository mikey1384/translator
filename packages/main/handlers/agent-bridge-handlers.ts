/** Secure IPC bridge between the packaged agent socket and the active tab. */

import { randomUUID } from 'node:crypto';
import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import log from 'electron-log';
import {
  getActiveAppWebContents,
  getAllAppWebContents,
} from '../utils/window.js';
import { AgentHistoryRouteRegistry } from '../utils/agent-history-routing.js';
import {
  AgentBridgeDeliveryUnknownError,
  AgentBridgeNotDeliveredError,
  AgentBridgeResponseError,
  isDefiniteAgentBridgeStartFailure,
} from '../utils/agent-bridge-delivery.js';

type AgentMethod = string;
type AgentParams = Record<string, unknown>;

const HISTORY_START_METHODS = new Set([
  'startTranscription',
  'startTranslation',
  'startMerge',
]);
const HISTORY_OWNED_METHODS = new Set([
  ...HISTORY_START_METHODS,
  'processingStatus',
  'cancelProcessing',
]);
const MCP_JOB_START_METHODS = new Set([
  'startTranscription',
  'startTranslation',
  'startDubbing',
  'startSummary',
  'startCueTranslation',
  'startCueTranscription',
  'startMerge',
  'startMediaWorkflow',
  'startPresetRender',
  'renderPreview',
]);
const MAX_HISTORY_ID_LENGTH = 512;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_TERMINAL_CHANNEL = 'agent-history-job-terminal';
const MCP_JOB_TERMINAL_CHANNEL = 'agent-mcp-job-terminal';

const historyRoutes = new AgentHistoryRouteRegistry<WebContents>();
const mcpJobRoutes = new AgentHistoryRouteRegistry<WebContents>();
let lifecycleHandlersRegistered = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getHistoryId(params: AgentParams): string | null {
  if (!Object.hasOwn(params, 'historyId')) return null;
  if (typeof params.historyId !== 'string') {
    throw new Error('history_id must be a string.');
  }
  const historyId = params.historyId.trim();
  if (!historyId || historyId.length > MAX_HISTORY_ID_LENGTH) {
    throw new Error(
      `history_id must contain between 1 and ${MAX_HISTORY_ID_LENGTH} characters.`
    );
  }
  return historyId;
}

function getMcpJobId(params: AgentParams): string | null {
  if (!Object.hasOwn(params, 'mcpJobId')) return null;
  const jobId =
    typeof params.mcpJobId === 'string' ? params.mcpJobId.trim() : '';
  if (!UUID_V4_PATTERN.test(jobId)) {
    throw new Error('mcp_job_id must be a UUID v4 string.');
  }
  return jobId;
}

function isTerminalAgentResult(method: string, result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (method === 'renderPreview') return true;
  const candidate =
    method === 'cancelProcessing' && isRecord(result.historyJob)
      ? result.historyJob
      : result;
  if (candidate.inProgress === false) return true;
  return ['completed', 'failed', 'cancelled', 'idle', 'unknown'].includes(
    String(candidate.status || '')
  );
}

function chooseHistoryTarget(): WebContents | null {
  return historyRoutes.chooseLeastLoaded(
    getAllAppWebContents(),
    getActiveAppWebContents()
  );
}

function forwardAgentRequest(
  method: AgentMethod,
  params: AgentParams,
  target?: WebContents | null,
  signal?: AbortSignal,
  historyRouteToken?: string | null,
  mcpJobId?: string | null,
  mcpJobRouteToken?: string | null
): Promise<unknown> {
  const webContents = target ?? getActiveAppWebContents();
  if (!webContents || webContents.isDestroyed()) {
    return Promise.reject(
      new AgentBridgeNotDeliveredError('Active tab WebContents not available')
    );
  }

  return new Promise((resolve, reject) => {
    const responseChannel = `agent-bridge-response:${randomUUID()}`;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      ipcMain.removeListener(responseChannel, onResponse);
      signal?.removeEventListener('abort', onAbort);
      webContents.removeListener('destroyed', onTargetGone);
      webContents.removeListener('render-process-gone', onTargetGone);
      webContents.removeListener('did-start-navigation', onTargetNavigation);
    };
    const onAbort = () => {
      cleanup();
      reject(
        new AgentBridgeDeliveryUnknownError(
          'Packaged agent client disconnected after request delivery began.'
        )
      );
    };
    const onResponse = (event: IpcMainEvent, response: any) => {
      // Only the exact tab that received the request may answer it. A response
      // from another renderer must not consume or spoof the pending request.
      if (event.sender !== webContents) return;
      cleanup();
      if (response?.error) {
        reject(new AgentBridgeResponseError(String(response.error)));
      } else resolve(response?.result);
    };
    const onTargetGone = () => {
      cleanup();
      reject(
        new AgentBridgeDeliveryUnknownError(
          'Target renderer disconnected after request delivery began.'
        )
      );
    };
    const onTargetNavigation = (
      details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
    ) => {
      if (details.isMainFrame && !details.isSameDocument) onTargetGone();
    };

    if (signal?.aborted) {
      reject(
        new AgentBridgeNotDeliveredError('Packaged agent client disconnected.')
      );
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    webContents.once('destroyed', onTargetGone);
    webContents.once('render-process-gone', onTargetGone);
    webContents.on('did-start-navigation', onTargetNavigation);
    timeout = setTimeout(() => {
      cleanup();
      reject(
        new AgentBridgeDeliveryUnknownError(
          `Agent bridge delivery is unknown after timeout for method: ${method}`
        )
      );
    }, 120_000);
    ipcMain.on(responseChannel, onResponse);

    try {
      webContents.send('agent-bridge-request', {
        method,
        params,
        responseChannel,
        ...(historyRouteToken ? { historyRouteToken } : {}),
        ...(mcpJobId ? { mcpJobId } : {}),
        ...(mcpJobRouteToken ? { mcpJobRouteToken } : {}),
      });
    } catch (error) {
      cleanup();
      reject(
        new AgentBridgeNotDeliveredError(
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  });
}

/** Register renderer-to-main terminal acknowledgements once for app lifetime. */
export function registerAgentBridgeLifecycleHandlers(): void {
  if (lifecycleHandlersRegistered) return;
  lifecycleHandlersRegistered = true;

  ipcMain.on(HISTORY_TERMINAL_CHANNEL, (event, payload: unknown) => {
    if (!isRecord(payload)) return;
    const historyId =
      typeof payload.historyId === 'string' ? payload.historyId.trim() : '';
    const routeToken =
      typeof payload.routeToken === 'string' ? payload.routeToken : '';
    if (
      !historyId ||
      historyId.length > MAX_HISTORY_ID_LENGTH ||
      !UUID_V4_PATTERN.test(routeToken)
    ) {
      return;
    }
    historyRoutes.markInactiveByToken(historyId, event.sender, routeToken);
  });

  ipcMain.on(MCP_JOB_TERMINAL_CHANNEL, (event, payload: unknown) => {
    if (!isRecord(payload)) return;
    const jobId = typeof payload.jobId === 'string' ? payload.jobId.trim() : '';
    const operationId =
      typeof payload.operationId === 'string' ? payload.operationId.trim() : '';
    const routeToken =
      typeof payload.routeToken === 'string' ? payload.routeToken : '';
    if (
      !UUID_V4_PATTERN.test(jobId) ||
      !operationId ||
      operationId.length > 200 ||
      /[\p{Cc}]/u.test(operationId) ||
      !UUID_V4_PATTERN.test(routeToken)
    ) {
      return;
    }
    mcpJobRoutes.markInactiveByToken(jobId, event.sender, routeToken);
  });
}

/** Call an agent method directly from AgentSocketServer. */
export async function callAgentMethod(
  method: AgentMethod,
  params: AgentParams,
  signal?: AbortSignal,
  sessionTarget?: WebContents | null
): Promise<unknown> {
  const historyId = getHistoryId(params);
  const mcpJobId = getMcpJobId(params);
  const historyOwned = historyId && HISTORY_OWNED_METHODS.has(method);
  let target: WebContents | null = sessionTarget ?? null;
  let historyRouteToken: string | null = null;
  let observedHistoryRouteToken: string | null = null;
  let previousRoute: ReturnType<typeof historyRoutes.setActive> = null;
  let mcpJobRouteToken: string | null = null;
  let observedMcpJobRouteToken: string | null = null;
  let previousMcpJobRoute: ReturnType<typeof mcpJobRoutes.setActive> = null;
  const existingHistoryRoute = historyId
    ? historyRoutes.getSnapshot(historyId)
    : null;
  const existingMcpJobRoute = mcpJobId
    ? mcpJobRoutes.getSnapshot(mcpJobId)
    : null;

  if (
    historyOwned &&
    existingHistoryRoute?.active &&
    existingMcpJobRoute?.active &&
    existingHistoryRoute.target.id !== existingMcpJobRoute.target.id
  ) {
    throw new AgentBridgeResponseError(
      'The persistent MCP job and library operation are owned by different Translator tabs.'
    );
  }

  target =
    existingMcpJobRoute?.target ??
    (historyOwned ? existingHistoryRoute?.target : null) ??
    (historyOwned ? chooseHistoryTarget() : target);

  if (mcpJobId && (!target || target.isDestroyed())) {
    throw new AgentBridgeNotDeliveredError(
      'No Translator tab is available for the persistent MCP job.'
    );
  }

  if (historyOwned) {
    if (!target) {
      throw new AgentBridgeNotDeliveredError(
        'No Translator tab is available for the history job.'
      );
    }
    if (HISTORY_START_METHODS.has(method)) {
      // The renderer rejects a second active job for the same library item.
      // Reject it before installing a tentative generation: otherwise the
      // original job can finish while its route is temporarily superseded,
      // causing that exact terminal acknowledgement to be discarded as stale.
      if (
        existingHistoryRoute?.active &&
        !(
          mcpJobId &&
          existingMcpJobRoute?.active &&
          existingMcpJobRoute.target.id === existingHistoryRoute.target.id
        )
      ) {
        throw new AgentBridgeResponseError(
          'This library item already has an active agent operation.'
        );
      }
      if (existingHistoryRoute?.active) {
        observedHistoryRouteToken = existingHistoryRoute.token;
      } else {
        historyRouteToken = randomUUID();
        previousRoute = historyRoutes.setActive(
          historyId,
          target,
          historyRouteToken
        );
      }
    } else {
      observedHistoryRouteToken = existingHistoryRoute?.token ?? null;
    }
  }

  if (mcpJobId && target) {
    if (MCP_JOB_START_METHODS.has(method)) {
      if (existingMcpJobRoute?.active) {
        observedMcpJobRouteToken = existingMcpJobRoute.token;
      } else {
        mcpJobRouteToken = randomUUID();
        previousMcpJobRoute = mcpJobRoutes.setActive(
          mcpJobId,
          target,
          mcpJobRouteToken
        );
      }
    } else if (existingMcpJobRoute) {
      observedMcpJobRouteToken = existingMcpJobRoute.token;
    } else {
      mcpJobRoutes.setInactive(mcpJobId, target);
    }
  }

  const forwardedParams = { ...params };
  if (mcpJobId) delete forwardedParams.mcpJobId;

  try {
    const result = await forwardAgentRequest(
      method,
      forwardedParams,
      target,
      signal,
      historyRouteToken,
      mcpJobId,
      mcpJobRouteToken
    );
    if (
      historyId &&
      historyOwned &&
      target &&
      isRecord(result) &&
      (method === 'processingStatus' || method === 'cancelProcessing')
    ) {
      const historyJob =
        method === 'cancelProcessing' && isRecord(result.historyJob)
          ? result.historyJob
          : result;
      if (historyJob.inProgress === false) {
        if (observedHistoryRouteToken) {
          historyRoutes.markInactiveByToken(
            historyId,
            target,
            observedHistoryRouteToken
          );
        } else {
          historyRoutes.markInactive(historyId, target);
        }
      }
    }
    if (mcpJobId && target && isTerminalAgentResult(method, result)) {
      const terminalToken =
        mcpJobRouteToken || observedMcpJobRouteToken || null;
      if (terminalToken) {
        mcpJobRoutes.markInactiveByToken(mcpJobId, target, terminalToken);
      } else {
        mcpJobRoutes.markInactive(mcpJobId, target);
      }
    }
    return result;
  } catch (error) {
    // Timeout or packaged-client disconnect after send is ambiguous: the
    // renderer may already have started durable background work. Preserve its
    // exact owner route. Only a renderer rejection or definite non-delivery
    // proves the start did not survive.
    const startDefinitelyDidNotBegin = isDefiniteAgentBridgeStartFailure(error);
    if (historyId && historyRouteToken && startDefinitelyDidNotBegin) {
      historyRoutes.restoreIfToken(historyId, historyRouteToken, previousRoute);
    }
    if (mcpJobId && mcpJobRouteToken && startDefinitelyDidNotBegin) {
      mcpJobRoutes.restoreIfToken(
        mcpJobId,
        mcpJobRouteToken,
        previousMcpJobRoute
      );
    }
    if (!signal?.aborted) {
      log.error(`[agent-bridge] Failed to call ${method}:`, error);
    }
    throw error;
  }
}
