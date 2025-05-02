declare module 'electron-store' {
  type ElectronStoreOptions<T extends Record<string, any>> = {
    name?: string;
    defaults?: Partial<T>;
    cwd?: string;
    encryptionKey?: string | Buffer;
    fileExtension?: string;
    clearInvalidConfig?: boolean;
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
    accessPropertiesByDotNotation?: boolean;
    watch?: boolean;
    migrations?: Record<string, (store: ElectronStore<T>) => void>;
    beforeEachMigration?: (
      store: ElectronStore<T>,
      context: { fromVersion: string; toVersion: string }
    ) => void;
    afterEachMigration?: (
      store: ElectronStore<T>,
      context: { fromVersion: string; toVersion: string }
    ) => void;
    projectVersion?: string;
    scheme?: 'file' | 'app';
  };

  class ElectronStore<T extends Record<string, any> = Record<string, unknown>> {
    constructor(options?: ElectronStoreOptions<T>);

    // Properties
    readonly path: string;
    readonly size: number;

    // Methods
    get<K extends keyof T>(key: K): T[K];
    get<K extends keyof T, D>(key: K, defaultValue: D): T[K] | D;
    get(): T;

    set<K extends keyof T>(key: K, value: T[K]): void;
    set(value: Partial<T>): void;

    has<K extends keyof T>(key: K): boolean;

    reset(...keys: Array<keyof T>): void;
    reset(): void;

    delete<K extends keyof T>(key: K): boolean;

    clear(): void;

    onDidChange<K extends keyof T>(
      key: K,
      callback: (newValue: T[K], oldValue: T[K]) => void
    ): () => void;

    onDidAnyChange(callback: (newValue: T, oldValue: T) => void): () => void;

    store: T;
  }

  export default ElectronStore;
}

// Type definitions for node-machine-id
declare module 'node-machine-id' {
  /**
   * Returns the machine id synchronously
   * @param original - If true, returns the original value, not a hashed one
   */
  export function machineIdSync(original?: boolean): string;

  /**
   * Returns the machine id asynchronously
   * @param original - If true, returns the original value, not a hashed one
   */
  export function machineId(original?: boolean): Promise<string>;

  const pkg: {
    machineIdSync: typeof machineIdSync;
    machineId: typeof machineId;
  };

  export default pkg;
}

declare module 'webrtcvad' {
  // 1. Define the actual class constructor type
  class VadClass {
    constructor(sampleRate: 8000 | 16000 | 32000 | 48000, level: 0 | 1 | 2 | 3);
    process(audio: Buffer): boolean;
  }

  // 2. Define the shape of the inner default object seen in the log
  interface InnerDefault {
    __esModule: true;
    default: typeof VadClass; // The *inner* default holds the class
  }

  // 3. Define the shape of the outer module object (what we import)
  interface VadModule {
    __esModule: true;
    default: InnerDefault; // The *outer* default holds the inner object
  }

  // 4. Export the shape of the entire module using 'export ='
  const moduleExport: VadModule;
  export = moduleExport;
}
