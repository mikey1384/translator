import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_PENDING_FAILURES = 20;
const PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const ARCHITECTURES = new Set(['arm64', 'x64', 'ia32']);
const STARTUP_PHASES = new Set([
  'module_load',
  'services_initialization',
  'app_ready',
  'startup_cleanup',
  'window_creation',
  'renderer_ready',
  'runtime',
]);
const FAILURE_CLASSES = new Set([
  'startup_incomplete',
  'main_module_load_failed',
  'startup_initialization_failed',
  'main_process_exception',
  'main_process_rejection',
  'renderer_process_gone',
  'child_process_gone',
]);
const RENDERER_REASONS = new Set([
  'clean-exit',
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'unknown',
]);

function readState(stateFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safePhase(value) {
  return STARTUP_PHASES.has(value) ? value : 'module_load';
}

function safeFailureClass(value) {
  return FAILURE_CLASSES.has(value) ? value : 'main_process_exception';
}

function safeRendererReason(value) {
  return RENDERER_REASONS.has(value) ? value : 'unknown';
}

function validAttempt(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.attemptId === 'string' &&
    typeof value.appVersion === 'string' &&
    PLATFORMS.has(value.platform) &&
    ARCHITECTURES.has(value.architecture)
  );
}

function validFailure(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.eventId === 'string' &&
    typeof value.failureClass === 'string' &&
    typeof value.startupPhase === 'string' &&
    typeof value.failedAppVersion === 'string' &&
    PLATFORMS.has(value.failedPlatform) &&
    ARCHITECTURES.has(value.failedArchitecture) &&
    FAILURE_CLASSES.has(value.failureClass) &&
    STARTUP_PHASES.has(value.startupPhase) &&
    (value.processReason === undefined ||
      RENDERER_REASONS.has(value.processReason))
  );
}

export function createStartupHealth({
  stateFile,
  appVersion,
  platform,
  architecture,
}) {
  let state = readState(stateFile);
  let pendingFailures = Array.isArray(state.pendingFailures)
    ? state.pendingFailures.filter(validFailure).slice(-MAX_PENDING_FAILURES)
    : [];

  if (validAttempt(state.currentAttempt)) {
    pendingFailures.push({
      eventId: randomUUID(),
      failureClass: 'startup_incomplete',
      startupPhase: safePhase(state.currentAttempt.startupPhase),
      failedAppVersion: state.currentAttempt.appVersion.slice(0, 32),
      failedPlatform: state.currentAttempt.platform,
      failedArchitecture: state.currentAttempt.architecture,
    });
  }

  state = {
    schemaVersion: 1,
    currentAttempt: {
      attemptId: randomUUID(),
      appVersion: String(appVersion).slice(0, 32),
      platform: String(platform),
      architecture: String(architecture),
      startupPhase: 'module_load',
    },
    pendingFailures: pendingFailures.slice(-MAX_PENDING_FAILURES),
  };

  function save() {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const temporaryFile = `${stateFile}.tmp`;
      fs.writeFileSync(temporaryFile, JSON.stringify(state), {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(temporaryFile, stateFile);
      fs.chmodSync(stateFile, 0o600);
    } catch {
      // Failure telemetry must never make the product fail to start.
    }
  }

  function setPhase(startupPhase) {
    if (!state.currentAttempt) return;
    state.currentAttempt.startupPhase = safePhase(startupPhase);
    save();
  }

  function markSuccessful() {
    state.currentAttempt = null;
    save();
  }

  function recordFailure(failureClass, startupPhase, processReason) {
    const current = state.currentAttempt;
    if (!current && startupPhase !== 'runtime') return;
    const failure = {
      eventId: randomUUID(),
      failureClass: safeFailureClass(failureClass),
      startupPhase: safePhase(
        startupPhase || current?.startupPhase || 'runtime'
      ),
      failedAppVersion: String(current?.appVersion || appVersion).slice(0, 32),
      failedPlatform: String(current?.platform || platform),
      failedArchitecture: String(current?.architecture || architecture),
      ...(failureClass === 'renderer_process_gone' ||
      failureClass === 'child_process_gone'
        ? { processReason: safeRendererReason(processReason) }
        : {}),
    };
    state.pendingFailures = [...state.pendingFailures, failure].slice(
      -MAX_PENDING_FAILURES
    );
    if (state.currentAttempt && startupPhase !== 'runtime') {
      state.currentAttempt = null;
    }
    save();
  }

  function listPendingFailures() {
    return state.pendingFailures
      .filter(validFailure)
      .map(value => ({ ...value }));
  }

  function acknowledgeFailure(eventId) {
    state.pendingFailures = state.pendingFailures.filter(
      failure => failure.eventId !== eventId
    );
    save();
  }

  save();
  return {
    setPhase,
    markSuccessful,
    recordFailure,
    listPendingFailures,
    acknowledgeFailure,
  };
}
