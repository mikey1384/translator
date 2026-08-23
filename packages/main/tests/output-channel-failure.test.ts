import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import electronLog from 'electron-log/node.js';
import {
  createIdempotentShutdownRequest,
  installOutputChannelFailureGuard,
  type OutputFailureLogger,
} from '../output-channel-failure.js';

function brokenPipeError(): NodeJS.ErrnoException {
  return Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
}

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function createLoggerHarness() {
  let consoleFailure: Error | null = null;
  let consoleWrites = 0;
  let internalErrorReports = 0;
  const fileMessages: unknown[][] = [];

  const logger = {
    transports: {
      console: {
        level: 'debug' as string | false,
        writeFn() {
          consoleWrites += 1;
          if (consoleFailure) throw consoleFailure;
        },
      },
    },
    processInternalErrorFn(error: unknown) {
      internalErrorReports += 1;
      logger.transports.console.writeFn({
        message: { data: ['internal logger error', error], level: 'error' },
      });
    },
    error(...data: unknown[]) {
      write('error', data);
    },
    info(...data: unknown[]) {
      write('info', data);
    },
  } as OutputFailureLogger & { info: (...data: unknown[]) => void };

  function write(level: string, data: unknown[]) {
    fileMessages.push(data);
    if (logger.transports.console.level === false) return;

    try {
      logger.transports.console.writeFn({ message: { data, level } });
    } catch (error) {
      logger.processInternalErrorFn(error);
    }
  }

  return {
    logger,
    fileMessages,
    failConsole(error: Error = brokenPipeError()) {
      consoleFailure = error;
    },
    get consoleWrites() {
      return consoleWrites;
    },
    get internalErrorReports() {
      return internalErrorReports;
    },
  };
}

test('independent terminal failures share one shutdown request', () => {
  const exitCodes: number[] = [];
  const requestShutdown = createIdempotentShutdownRequest((code: number) => {
    exitCodes.push(code);
  });

  assert.equal(requestShutdown(1), true);
  assert.equal(requestShutdown(0), false);
  assert.equal(requestShutdown(1), false);
  assert.deepEqual(exitCodes, [1]);
});

test('a synchronous shutdown request failure is still invoked at most once', () => {
  let attempts = 0;
  const requestShutdown = createIdempotentShutdownRequest(() => {
    attempts += 1;
    throw new Error('app.exit unavailable');
  });

  assert.throws(() => requestShutdown(undefined), /app\.exit unavailable/);
  assert.equal(requestShutdown(undefined), false);
  assert.equal(requestShutdown(undefined), false);
  assert.equal(attempts, 1);
});

test('one console EPIPE is contained before electron-log can recursively report it', () => {
  const harness = createLoggerHarness();
  let shutdownRequests = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {
      shutdownRequests += 1;
    },
  });

  harness.failConsole();
  assert.doesNotThrow(() => harness.logger.error('trigger broken output'));

  assert.equal(harness.consoleWrites, 1);
  assert.equal(harness.internalErrorReports, 0);
  assert.equal(shutdownRequests, 1);
  assert.equal(harness.logger.transports.console.level, false);
  assert.equal(guard.hasFailed(), true);
  assert.equal(
    harness.fileMessages.length,
    2,
    'the original log and one file-only failure record should remain'
  );
});

test('the global exception boundaries suppress only previously observed output EPIPEs', () => {
  const source = fs.readFileSync(path.join(packageRoot, 'index.ts'), 'utf8');
  const handlerStart = source.indexOf(
    "nodeProcess.on('uncaughtException', error => {"
  );
  const handlerEnd = source.indexOf(
    "nodeProcess.on('unhandledRejection'",
    handlerStart
  );
  const handler = source.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.ok(
    handler.indexOf(
      'outputChannelFailureGuard.shouldSuppressUnhandled(error)'
    ) < handler.indexOf("log.error('[main.ts] UNCAUGHT EXCEPTION:'"),
    'known output-failure suppression must precede uncaught-exception logging'
  );

  const rejectionStart = source.indexOf(
    "nodeProcess.on('unhandledRejection', reason => {"
  );
  const rejectionHandler = source.slice(rejectionStart);
  assert.ok(rejectionStart >= 0);
  assert.ok(
    rejectionHandler.indexOf(
      'outputChannelFailureGuard.shouldSuppressUnhandled(reason)'
    ) < rejectionHandler.indexOf("log.error('[main.ts] UNHANDLED REJECTION:'"),
    'known output-failure suppression must precede rejection logging'
  );
});

test('development ownership loss requests an abnormal process exit', () => {
  const source = fs.readFileSync(path.join(packageRoot, 'index.ts'), 'utf8');
  const leaseStart = source.indexOf(
    'const developmentOwnerLeaseClient = installDevelopmentOwnerLeaseClient'
  );
  const leaseEnd = source.indexOf("app.once('quit'", leaseStart);
  const leaseHandler = source.slice(leaseStart, leaseEnd);

  assert.ok(leaseStart >= 0 && leaseEnd > leaseStart);
  assert.match(leaseHandler, /requestOwnershipFailureExit\(1\)/);
  assert.doesNotMatch(leaseHandler, /requestOwnershipFailureExit\(0\)/);
});

test('an unrelated first EPIPE is not inferred to be a failed output channel', () => {
  const harness = createLoggerHarness();
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {},
  });
  const unrelatedPipe = brokenPipeError();

  assert.equal(guard.shouldSuppressUnhandled(unrelatedPipe), false);
  assert.equal(guard.handle(unrelatedPipe), true);
  assert.equal(guard.shouldSuppressUnhandled(unrelatedPipe), true);
});

test('the real electron-log console transport cannot re-enter on EPIPE', () => {
  const logger = electronLog.create({ logId: 'output-channel-epipe-test' });
  for (const [name, transport] of Object.entries(logger.transports)) {
    if (transport) transport.level = name === 'console' ? 'debug' : false;
  }
  let consoleWrites = 0;
  logger.transports.console.writeFn = () => {
    consoleWrites += 1;
    throw brokenPipeError();
  };
  let shutdownRequests = 0;
  const guard = installOutputChannelFailureGuard({
    logger: logger as unknown as OutputFailureLogger,
    requestShutdown: () => {
      shutdownRequests += 1;
    },
  });

  assert.doesNotThrow(() => logger.error('real electron-log EPIPE'));

  assert.equal(consoleWrites, 1);
  assert.equal(shutdownRequests, 1);
  assert.equal(logger.transports.console.level, false);
  guard.dispose();
});

test('many queued stdout and stderr EPIPE events request shutdown once', () => {
  const harness = createLoggerHarness();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let shutdownRequests = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    stdout,
    stderr,
    requestShutdown: () => {
      shutdownRequests += 1;
    },
  });

  for (let index = 0; index < 50; index += 1) {
    stdout.emit('error', brokenPipeError());
    stderr.emit('error', brokenPipeError());
    assert.equal(guard.handle(brokenPipeError()), true);
  }

  assert.equal(shutdownRequests, 1);
  assert.equal(harness.fileMessages.length, 1);
  guard.dispose();
});

test('a shutdown callback that synchronously surfaces another EPIPE is not re-entered', () => {
  const harness = createLoggerHarness();
  let shutdownRequests = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {
      shutdownRequests += 1;
      guard.handle(brokenPipeError());
    },
  });

  assert.equal(guard.handle(brokenPipeError()), true);
  assert.equal(shutdownRequests, 1);
  assert.equal(harness.fileMessages.length, 1);
});

test('a synchronous shutdown-request failure cannot be re-entered by queued EPIPEs', () => {
  const harness = createLoggerHarness();
  let shutdownAttempts = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {
      shutdownAttempts += 1;
      throw new Error('exit unavailable');
    },
  });

  assert.equal(guard.handle(brokenPipeError()), true);
  assert.equal(guard.handle(brokenPipeError()), true);
  assert.equal(guard.handle(brokenPipeError()), true);

  assert.equal(shutdownAttempts, 1);
  assert.equal(harness.fileMessages.length, 1);
  assert.equal(harness.logger.transports.console.level, false);
});

test('a rejected shutdown request cannot be re-entered by later EPIPEs', async () => {
  const harness = createLoggerHarness();
  let shutdownAttempts = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {
      shutdownAttempts += 1;
      return Promise.reject(new Error('exit unavailable'));
    },
  });

  assert.equal(guard.handle(brokenPipeError()), true);
  await Promise.resolve();
  for (let index = 0; index < 20; index += 1) {
    assert.equal(guard.handle(brokenPipeError()), true);
  }

  assert.equal(shutdownAttempts, 1);
  assert.equal(harness.fileMessages.length, 1);
});

test('normal non-EPIPE logging still reaches console and file transports', () => {
  const harness = createLoggerHarness();
  let shutdownRequests = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {
      shutdownRequests += 1;
    },
  });

  harness.logger.info('normal development log');

  assert.equal(harness.consoleWrites, 1);
  assert.deepEqual(harness.fileMessages, [['normal development log']]);
  assert.equal(shutdownRequests, 0);
  assert.equal(guard.hasFailed(), false);
});

test('unrelated logger failures retain the existing internal-error behavior', () => {
  const harness = createLoggerHarness();
  const unrelatedError = Object.assign(new Error('unrelated write failure'), {
    code: 'EIO',
  });
  let shutdownRequests = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {
      shutdownRequests += 1;
    },
  });
  harness.failConsole(unrelatedError);

  assert.throws(
    () => harness.logger.error('unrelated failure'),
    unrelatedError
  );
  assert.equal(harness.internalErrorReports, 1);
  assert.equal(shutdownRequests, 0);
  assert.equal(guard.hasFailed(), false);
  assert.equal(harness.logger.transports.console.level, 'debug');
});

test('an EPIPE from a non-console logger transport is not treated as stdio loss', () => {
  const harness = createLoggerHarness();
  let shutdownRequests = 0;
  const guard = installOutputChannelFailureGuard({
    logger: harness.logger,
    requestShutdown: () => {
      shutdownRequests += 1;
    },
  });

  harness.logger.processInternalErrorFn(brokenPipeError());

  assert.equal(harness.internalErrorReports, 1);
  assert.equal(harness.consoleWrites, 1);
  assert.equal(shutdownRequests, 0);
  assert.equal(guard.hasFailed(), false);
  assert.equal(harness.logger.transports.console.level, 'debug');
});
