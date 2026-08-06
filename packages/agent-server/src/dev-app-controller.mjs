import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDirectory, '../../..');
const appDirectory = path.join(repoRoot, 'packages', 'main');
const electronExecutable = path.join(
  repoRoot,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron'
);

export class DevAppController {
  constructor() {
    this.app = null;
    this.page = null;
  }

  async launch() {
    if (this.page && !this.page.isClosed()) return this.status();
    const { _electron: electron } = await import('playwright-core');
    this.app = await electron.launch({
      executablePath: electronExecutable,
      args: [appDirectory],
      cwd: appDirectory,
      env: {
        ...process.env,
        TRANSLATOR_AGENT_DEV: '1',
      },
      timeout: 45_000,
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const windows = this.app.windows();
      this.page =
        windows.find(page =>
          page.url().includes('renderer/dist/index.html')
        ) || null;
      if (this.page) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!this.page) throw new Error('Translator renderer did not become ready.');
    await this.page.waitForFunction(
      () => Boolean(window.translatorAgent?.status),
      null,
      { timeout: 20_000 }
    );
    return this.status();
  }

  async ensureReady() {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Development app is not running. Call app_launch first.');
    }
  }

  async call(method, args = undefined) {
    await this.ensureReady();
    return this.page.evaluate(
      async ({ methodName, methodArgs }) => {
        const bridge = window.translatorAgent;
        const fn = bridge?.[methodName];
        if (typeof fn !== 'function') {
          throw new Error(`Unknown Translator agent method: ${methodName}`);
        }
        return fn(methodArgs);
      },
      { methodName: method, methodArgs: args }
    );
  }

  async status() {
    return this.call('status');
  }

  async screenshot(outputPath) {
    await this.ensureReady();
    const destination = path.resolve(outputPath);
    await this.page.screenshot({ path: destination });
    return { outputPath: destination };
  }

  async close() {
    if (this.app) await this.app.close().catch(() => {});
    this.app = null;
    this.page = null;
  }
}
